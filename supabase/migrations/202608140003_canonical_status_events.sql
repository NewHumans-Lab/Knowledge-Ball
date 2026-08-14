-- Keep browser and hosted Scheme 7 event contracts identical. Legacy Node*
-- envelopes remain readable for migration, but all new status writes use one
-- validated canonical event family.
alter table public.public_knowledge_events drop constraint if exists public_knowledge_events_event_type_check;
alter table public.public_knowledge_events add constraint public_knowledge_events_event_type_check
  check (event_type in ('NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved',
    'KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged','KnowledgeNodeEdited'));

create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare kind text := item#>>'{payload,edit,kind}'; status text := item#>>'{payload,edit,status}';
begin
  if jsonb_path_exists(item, '$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode = '22023';
  end if;
  if (item->>'type', kind) in (('KnowledgeAdded','add'), ('KnowledgeNegated','negate'),
      ('KnowledgeDecomposed','decompose'), ('KnowledgeMerged','merge')) then
    return;
  end if;
  if item->>'type' = 'KnowledgeStatusChanged' and kind = 'status'
      and status in ('verified','suspended','disputed')
      and nullif(item#>>'{payload,edit,nodeId}', '') is not null
      and (status <> 'suspended' or nullif(item#>>'{payload,edit,causeNodeId}', '') is not null) then
    return;
  end if;
  if item->>'type' = 'KnowledgeNodeEdited' and kind = 'update'
      and nullif(item#>>'{payload,edit,nodeId}', '') is not null then return; end if;
  raise exception 'event type does not match canonical knowledge command' using errcode = '22023';
end $$;

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path = public, pg_temp
as $$ select '202608140003'::text $$;

create or replace function public.append_public_knowledge_events(expected_head bigint, event_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare current_head bigint; item jsonb; existing jsonb; actor uuid := auth.uid(); ids text[] := '{}';
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(event_batch) <> 'array' or jsonb_array_length(event_batch) > 100 then raise exception 'invalid event batch' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence),0) into current_head from public.public_knowledge_events;
  if current_head <> expected_head then raise exception 'remote head conflict' using errcode = 'KB409', detail = jsonb_build_object('current_head',current_head)::text; end if;
  for item in select value from jsonb_array_elements(event_batch) loop
    if item->>'scope' <> 'public' or (item->>'schemaVersion')::integer <> 1 or nullif(item->>'id','') is null
       or jsonb_typeof(item->'payload') <> 'object' or octet_length(item::text) > 65536 then raise exception 'invalid public event envelope' using errcode = '22023'; end if;
    perform public.validate_public_knowledge_event(item);
    select envelope into existing from public.public_knowledge_events where event_id=item->>'id';
    if existing is not null and existing <> item then raise exception 'event id already has a different envelope' using errcode = '23505'; end if;
    insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
      values(item->>'id',1,item->>'type',item,actor) on conflict(event_id) do nothing;
    ids := array_append(ids,item->>'id');
  end loop;
  select coalesce(max(sequence),0) into current_head from public.public_knowledge_events;
  return jsonb_build_object('head',current_head,'acknowledged_event_ids',to_jsonb(ids));
end $$;
revoke all on function public.append_public_knowledge_events(bigint,jsonb) from public,anon;
grant execute on function public.append_public_knowledge_events(bigint,jsonb) to authenticated;
