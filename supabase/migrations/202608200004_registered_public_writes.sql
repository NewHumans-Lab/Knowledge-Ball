-- Public knowledge creation is a registered-account capability.
-- Anonymous Supabase sessions remain usable for public reads and, until the
-- product policy is decided separately, the existing pending-vote APIs. They
-- must never be able to append authoritative public knowledge events.

create or replace function public.append_public_knowledge_events(
  expected_head bigint,
  event_batch jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_head bigint;
  item jsonb;
  existing jsonb;
  actor uuid := auth.uid();
  ids text[] := '{}';
  inserted_at timestamptz;
  added_node_id text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.knowledge_ball_profiles p
    join auth.users u on u.id = p.user_id
    where p.user_id = actor
      and p.active
      and p.password_login_enabled
      and u.is_anonymous is false
  ) then
    raise exception '请先注册或登录账户后再提交公共知识' using errcode = '42501';
  end if;

  if jsonb_typeof(event_batch) <> 'array' or jsonb_array_length(event_batch) > 100 then
    raise exception 'invalid event batch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence), 0)
    into current_head
    from public.public_knowledge_events;

  if current_head <> expected_head then
    raise exception 'remote head conflict' using errcode = 'KB409',
      detail = jsonb_build_object('current_head', current_head)::text;
  end if;

  for item in select value from jsonb_array_elements(event_batch) loop
    if item->>'scope' <> 'public'
      or (item->>'schemaVersion')::integer <> 1
      or nullif(item->>'id', '') is null
      or jsonb_typeof(item->'payload') <> 'object'
      or octet_length(item::text) > 65536 then
      raise exception 'invalid public event envelope' using errcode = '22023';
    end if;

    perform public.validate_public_knowledge_event(item);

    select envelope
      into existing
      from public.public_knowledge_events
      where event_id = item->>'id';

    if existing is not null and existing <> item then
      raise exception 'event id already has a different envelope' using errcode = '23505';
    end if;

    inserted_at := null;
    insert into public.public_knowledge_events(
      event_id,
      schema_version,
      event_type,
      envelope,
      actor_id
    ) values (
      item->>'id',
      1,
      item->>'type',
      item,
      actor
    )
    on conflict(event_id) do nothing
    returning created_at into inserted_at;

    if inserted_at is not null and item->>'type' = 'KnowledgeAdded' then
      for added_node_id in
        select node_id
        from (values
          (item#>>'{payload,edit,node,id}'),
          (item#>>'{payload,edit,reasoning,id}'),
          (item#>>'{payload,edit,conclusion,id}')
        ) as added(node_id)
        where nullif(node_id, '') is not null
      loop
        perform public.fund_new_pending_vote_round(
          added_node_id,
          actor,
          inserted_at,
          item->>'id'
        );
      end loop;
    end if;

    ids := array_append(ids, item->>'id');
  end loop;

  select coalesce(max(sequence), 0)
    into current_head
    from public.public_knowledge_events;

  return jsonb_build_object(
    'head', current_head,
    'acknowledged_event_ids', to_jsonb(ids)
  );
end $$;

revoke all on function public.append_public_knowledge_events(bigint, jsonb)
from public, anon, authenticated;
grant execute on function public.append_public_knowledge_events(bigint, jsonb)
to authenticated;

comment on function public.append_public_knowledge_events(bigint, jsonb) is
  'Authoritative public knowledge append. Requires an active, non-anonymous Knowledge Ball account with permanent login enabled.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608200004'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
