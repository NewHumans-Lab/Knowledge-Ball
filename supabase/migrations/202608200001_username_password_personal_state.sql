-- Bind recoverable username/password accounts and private knowledge mastery to immutable auth.uid().
--
-- Public knowledge remains in public_knowledge_events. Personal mastery is a separate
-- private projection owned only by the authenticated user. Passwords are never stored
-- in public tables; the Edge Function links a Supabase Auth password identity to the
-- existing auth.users.id and this schema stores only whether that login is enabled.

alter table public.knowledge_ball_profiles
  add column if not exists password_login_enabled boolean not null default false,
  add column if not exists password_login_updated_at timestamptz;

-- The existing lower(username) unique index remains the single username namespace.
-- Reserve/change a username only for the caller's immutable auth.uid().
create or replace function public.reserve_my_username(new_username text) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  normalized text := lower(trim(coalesce(new_username, '')));
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'username must be 3-24 lowercase letters, digits, or underscores' using errcode = '22023';
  end if;

  perform public.ensure_anonymous_profile();
  begin
    update public.knowledge_ball_profiles
    set username = normalized,
        updated_at = now()
    where user_id = actor;
  exception when unique_violation then
    raise exception 'username already in use' using errcode = '23505';
  end;

  if not found then
    raise exception 'profile not found';
  end if;
  return normalized;
end $$;

revoke all on function public.reserve_my_username(text) from public, anon;
grant execute on function public.reserve_my_username(text) to authenticated;

create table if not exists public.personal_knowledge_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null check (char_length(node_id) between 1 and 200),
  mastery text not null check (mastery in ('none', 'touched', 'mastered')),
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create index if not exists personal_knowledge_states_user_updated
  on public.personal_knowledge_states(user_id, updated_at desc);

alter table public.personal_knowledge_states enable row level security;
revoke all on public.personal_knowledge_states from public, anon, authenticated;

-- Return only the caller's private state. No caller-supplied user_id is accepted.
create or replace function public.get_my_personal_knowledge_states() returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'node_id', node_id,
        'mastery', mastery,
        'version', version,
        'updated_at', updated_at
      ) order by node_id
    ),
    '[]'::jsonb
  )
  from public.personal_knowledge_states
  where user_id = auth.uid();
$$;

-- Viewing a node is monotonic: an old browser can never downgrade mastered -> touched.
create or replace function public.mark_my_knowledge_touched(target_node_id text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  result public.personal_knowledge_states%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if nullif(trim(target_node_id), '') is null or char_length(target_node_id) > 200 then
    raise exception 'invalid node id' using errcode = '22023';
  end if;

  insert into public.personal_knowledge_states(user_id, node_id, mastery)
  values(actor, target_node_id, 'touched')
  on conflict(user_id, node_id) do update
    set mastery = case
          when public.personal_knowledge_states.mastery = 'none' then 'touched'
          else public.personal_knowledge_states.mastery
        end,
        version = case
          when public.personal_knowledge_states.mastery = 'none'
            then public.personal_knowledge_states.version + 1
          else public.personal_knowledge_states.version
        end,
        updated_at = case
          when public.personal_knowledge_states.mastery = 'none' then now()
          else public.personal_knowledge_states.updated_at
        end
  returning * into result;

  return jsonb_build_object(
    'node_id', result.node_id,
    'mastery', result.mastery,
    'version', result.version,
    'updated_at', result.updated_at
  );
end $$;

-- Explicit user action may set any mastery value. Last committed explicit action wins.
create or replace function public.set_my_personal_knowledge_state(
  target_node_id text,
  new_mastery text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  result public.personal_knowledge_states%rowtype;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if nullif(trim(target_node_id), '') is null or char_length(target_node_id) > 200 then
    raise exception 'invalid node id' using errcode = '22023';
  end if;
  if new_mastery not in ('none', 'touched', 'mastered') then
    raise exception 'invalid mastery' using errcode = '22023';
  end if;

  insert into public.personal_knowledge_states(user_id, node_id, mastery)
  values(actor, target_node_id, new_mastery)
  on conflict(user_id, node_id) do update
    set mastery = excluded.mastery,
        version = case
          when public.personal_knowledge_states.mastery is distinct from excluded.mastery
            then public.personal_knowledge_states.version + 1
          else public.personal_knowledge_states.version
        end,
        updated_at = case
          when public.personal_knowledge_states.mastery is distinct from excluded.mastery then now()
          else public.personal_knowledge_states.updated_at
        end
  returning * into result;

  return jsonb_build_object(
    'node_id', result.node_id,
    'mastery', result.mastery,
    'version', result.version,
    'updated_at', result.updated_at
  );
end $$;

-- One-time legacy import is conservative: local history may only upgrade cloud mastery.
-- Replays are idempotent and can never overwrite a newer cloud downgrade after the
-- browser records its migration marker.
create or replace function public.merge_my_personal_knowledge_states(state_batch jsonb) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  node text;
  incoming text;
  processed integer := 0;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(state_batch) <> 'array' or jsonb_array_length(state_batch) > 1000 then
    raise exception 'invalid personal state batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(state_batch)
  loop
    node := item->>'node_id';
    incoming := item->>'mastery';
    if nullif(trim(node), '') is null or char_length(node) > 200
       or incoming not in ('none', 'touched', 'mastered') then
      raise exception 'invalid personal state item' using errcode = '22023';
    end if;

    insert into public.personal_knowledge_states(user_id, node_id, mastery)
    values(actor, node, incoming)
    on conflict(user_id, node_id) do update
      set mastery = case
            when case excluded.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
               > case public.personal_knowledge_states.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
              then excluded.mastery
            else public.personal_knowledge_states.mastery
          end,
          version = case
            when case excluded.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
               > case public.personal_knowledge_states.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
              then public.personal_knowledge_states.version + 1
            else public.personal_knowledge_states.version
          end,
          updated_at = case
            when case excluded.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
               > case public.personal_knowledge_states.mastery when 'mastered' then 2 when 'touched' then 1 else 0 end
              then now()
            else public.personal_knowledge_states.updated_at
          end;
    processed := processed + 1;
  end loop;

  return jsonb_build_object('processed', processed);
end $$;

revoke all on function public.get_my_personal_knowledge_states(),
  public.mark_my_knowledge_touched(text),
  public.set_my_personal_knowledge_state(text, text),
  public.merge_my_personal_knowledge_states(jsonb)
from public, anon;
grant execute on function public.get_my_personal_knowledge_states(),
  public.mark_my_knowledge_touched(text),
  public.set_my_personal_knowledge_state(text, text),
  public.merge_my_personal_knowledge_states(jsonb)
to authenticated;

-- Release gate: this feature must not be served by a frontend against an older schema.
create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608200001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
