create table public.public_knowledge_events (
  sequence bigint generated always as identity primary key,
  event_id text not null unique,
  schema_version integer not null check (schema_version = 1),
  event_type text not null check (event_type in ('NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved','KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged')),
  envelope jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (octet_length(envelope::text) <= 65536),
  check (envelope->>'scope' = 'public'),
  check (envelope->>'id' = event_id),
  check ((envelope->>'schemaVersion')::integer = schema_version),
  check (envelope->>'type' = event_type)
);

alter table public.public_knowledge_events enable row level security;
create policy "authenticated users read public events" on public.public_knowledge_events
  for select to authenticated using (true);

create table public.personal_knowledge_events (
  event_id text primary key,
  owner_id uuid not null references auth.users(id) default auth.uid(),
  schema_version integer not null check (schema_version = 1),
  event_type text not null check (event_type = 'NodeMasterySet'),
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  check (octet_length(envelope::text) <= 16384),
  check (envelope->>'scope' = 'personal')
);
alter table public.personal_knowledge_events enable row level security;
create policy "owners read personal events" on public.personal_knowledge_events for select to authenticated using (owner_id = auth.uid());
create policy "owners append personal events" on public.personal_knowledge_events for insert to authenticated with check (owner_id = auth.uid());

create or replace function public.reject_event_mutation() returns trigger language plpgsql as $$
begin raise exception 'event streams are append-only' using errcode = '42501'; end $$;
create trigger public_events_immutable before update or delete on public.public_knowledge_events for each row execute function public.reject_event_mutation();
create trigger personal_events_immutable before update or delete on public.personal_knowledge_events for each row execute function public.reject_event_mutation();

create or replace function public.append_public_knowledge_events(expected_head bigint, event_batch jsonb)
returns jsonb
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
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(event_batch) <> 'array' or jsonb_array_length(event_batch) > 100 then
    raise exception 'invalid event batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence), 0) into current_head from public.public_knowledge_events;
  if current_head <> expected_head then
    raise exception 'remote head conflict' using errcode = 'KB409', detail = jsonb_build_object('current_head', current_head)::text;
  end if;
  for item in select value from jsonb_array_elements(event_batch) loop
    if item->>'scope' <> 'public'
      or item->>'type' not in ('NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved','KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged')
      or (item->>'schemaVersion')::integer <> 1
      or nullif(item->>'id', '') is null
      or jsonb_typeof(item->'payload') <> 'object'
      or octet_length(item::text) > 65536 then
      raise exception 'invalid public event envelope' using errcode = '22023';
    end if;
    select envelope into existing from public.public_knowledge_events where event_id = item->>'id';
    if existing is not null and existing <> item then
      raise exception 'event id already has a different envelope' using errcode = '23505';
    end if;
    insert into public.public_knowledge_events(event_id, schema_version, event_type, envelope, actor_id)
      values(item->>'id', 1, item->>'type', item, actor)
      on conflict (event_id) do nothing;
    ids := array_append(ids, item->>'id');
  end loop;
  select coalesce(max(sequence), 0) into current_head from public.public_knowledge_events;
  return jsonb_build_object('head', current_head, 'acknowledged_event_ids', to_jsonb(ids));
end $$;

revoke all on public.public_knowledge_events from anon, authenticated;
grant select on public.public_knowledge_events to authenticated;
revoke all on function public.append_public_knowledge_events(bigint, jsonb) from public, anon;
grant execute on function public.append_public_knowledge_events(bigint, jsonb) to authenticated;
grant select, insert on public.personal_knowledge_events to authenticated;
