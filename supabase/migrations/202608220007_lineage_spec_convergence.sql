-- Knowledge Lineage V3 convergence / part 1.
-- Close legacy semantic-write bypasses and serialize every human head change.
-- This migration does not alter validation economics, energy formulas or lineage settlement.

create or replace function private.canonical_knowledge_title(value text) returns text
language sql immutable strict
set search_path = pg_catalog
as $$ select lower(regexp_replace(trim(value), '[[:space:]]+', ' ', 'g')) $$;
revoke all on function private.canonical_knowledge_title(text) from public, anon, authenticated;

-- Candidate submission and human gray/red revalidation share one topic lock.
-- The BEFORE trigger closes the race that remained between the validation query
-- and the authoritative lineage projection trigger.
create or replace function private.guard_lineage_candidate_insert() returns trigger
language plpgsql security definer
set search_path = private, public, pg_temp
as $$
declare
  topic_value text;
begin
  if new.event_type <> 'KnowledgeAdded' then return new; end if;
  if new.envelope#>'{payload,optimization}' is null
     and new.envelope#>'{payload,opposition}' is null then return new; end if;

  topic_value := coalesce(
    new.envelope#>>'{payload,optimization,topicId}',
    new.envelope#>>'{payload,opposition,topicId}'
  );
  if nullif(topic_value, '') is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('knowledge-head-change:' || topic_value, 0));
  if exists (
    select 1 from private.knowledge_revalidation_rounds r
    where r.topic_id = topic_value and r.verdict = 'PENDING'
  ) then
    raise exception 'knowledge topic already has an active revalidation round' using errcode='KB409';
  end if;
  return new;
end $$;
revoke all on function private.guard_lineage_candidate_insert() from public, anon, authenticated;

drop trigger if exists aa_guard_lineage_candidate_insert on public.public_knowledge_events;
create trigger aa_guard_lineage_candidate_insert
before insert on public.public_knowledge_events
for each row execute function private.guard_lineage_candidate_insert();

create or replace function private.guard_revalidation_head_change_insert() returns trigger
language plpgsql security definer
set search_path = private, public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('knowledge-head-change:' || new.topic_id, 0));
  if exists (
    select 1 from private.knowledge_lineage_members m
    where m.topic_id = new.topic_id
      and m.role in ('candidate-history', 'candidate-opposition')
  ) then
    raise exception 'knowledge topic already has a pending head-change candidate' using errcode='KB409';
  end if;
  return new;
end $$;
revoke all on function private.guard_revalidation_head_change_insert() from public, anon, authenticated;

drop trigger if exists aa_guard_revalidation_head_change_insert on private.knowledge_revalidation_rounds;
create trigger aa_guard_revalidation_head_change_insert
before insert on private.knowledge_revalidation_rounds
for each row execute function private.guard_revalidation_head_change_insert();

-- The server write boundary now treats the V3 immutable lineage protocol as the
-- only product path for semantic replacement/opposition. Historical events stay
-- replayable; only NEW legacy writes are rejected.
create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql stable
set search_path = public, private, pg_temp
as $$
declare
  kind text := item#>>'{payload,edit,kind}';
  status text := item#>>'{payload,edit,status}';
  layers jsonb := item#>'{payload,declaredLayers}';
  added_node_ids text[] := '{}';
  added_node_id text;
  layer_key text;
  declared_layer text;
  target_id text;
  topic_id text;
  candidate_title text;
  candidate_type text;
  target_title text;
  target_type text;
  target_row private.knowledge_lineage_members%rowtype;
  has_optimization boolean := item#>'{payload,optimization}' is not null;
  has_opposition boolean := item#>'{payload,opposition}' is not null;
begin
  if jsonb_path_exists(item, '$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode='22023';
  end if;
  if item->>'type' in (
    'KnowledgeVerdictFinalized','KnowledgeRevalidationStarted','KnowledgeRevalidationFinalized'
  ) then
    raise exception 'protocol lifecycle events are server-only' using errcode='42501';
  end if;
  if item->>'type' = 'KnowledgeNodeEdited' then
    raise exception 'immutable knowledge balls cannot be edited in place; submit an optimization candidate' using errcode='22023';
  end if;
  if item->>'type' = 'KnowledgeNegated' then
    raise exception 'legacy negation is read-only; submit an opposition candidate' using errcode='22023';
  end if;

  if item->>'type' = 'KnowledgeAdded' and kind = 'add' then
    if jsonb_typeof(layers) is distinct from 'object' then
      raise exception 'KnowledgeAdded must declare one canonical layer for every created node' using errcode='22023';
    end if;
    for added_node_id in
      select node_id from (values
        (item#>>'{payload,edit,node,id}'),
        (item#>>'{payload,edit,reasoning,id}'),
        (item#>>'{payload,edit,conclusion,id}')
      ) as added(node_id)
      where nullif(node_id,'') is not null
    loop
      if added_node_id = any(added_node_ids) then
        raise exception 'KnowledgeAdded contains duplicate created node id: %', added_node_id using errcode='22023';
      end if;
      added_node_ids := array_append(added_node_ids, added_node_id);
      declared_layer := layers->>added_node_id;
      if declared_layer is null or not exists (
        select 1 from public.knowledge_layer_definitions d where d.layer_code = declared_layer
      ) then
        raise exception 'KnowledgeAdded node % must declare inner, middle, or outer', added_node_id using errcode='22023';
      end if;
    end loop;
    if cardinality(added_node_ids) = 0 then
      raise exception 'KnowledgeAdded must create at least one node' using errcode='22023';
    end if;
    for layer_key in select jsonb_object_keys(layers) loop
      if not (layer_key = any(added_node_ids)) then
        raise exception 'declaredLayers contains a node not created by this event: %', layer_key using errcode='22023';
      end if;
    end loop;

    if has_optimization and has_opposition then
      raise exception 'KnowledgeAdded cannot be optimization and opposition simultaneously' using errcode='22023';
    end if;
    if has_optimization or has_opposition then
      if item#>>'{payload,edit,mode}' <> 'atomic' or cardinality(added_node_ids) <> 1 then
        raise exception 'lineage head-change candidate must be one atomic immutable node' using errcode='22023';
      end if;
      target_id := case when has_optimization
        then item#>>'{payload,optimization,targetId}'
        else item#>>'{payload,opposition,targetId}' end;
      topic_id := case when has_optimization
        then item#>>'{payload,optimization,topicId}'
        else item#>>'{payload,opposition,topicId}' end;
      candidate_title := item#>>'{payload,edit,node,title}';
      candidate_type := item#>>'{payload,edit,node,type}';
      if nullif(target_id,'') is null or nullif(topic_id,'') is null
         or nullif(candidate_title,'') is null or nullif(candidate_type,'') is null then
        raise exception 'lineage candidate requires targetId, topicId, title and type' using errcode='22023';
      end if;

      select * into target_row
      from private.knowledge_lineage_members
      where node_id = target_id;
      if not found or target_row.role <> 'current'
         or target_row.topic_id <> topic_id or target_row.revalidating then
        raise exception 'lineage candidate target is not the stable current head' using errcode='KB409';
      end if;
      if exists (
        select 1 from private.knowledge_lineage_members
        where topic_id = topic_id and role in ('candidate-history','candidate-opposition')
      ) then
        raise exception 'knowledge topic already has a pending head-change candidate' using errcode='KB409';
      end if;
      if exists (
        select 1 from private.knowledge_revalidation_rounds
        where topic_id = topic_id and verdict = 'PENDING'
      ) then
        raise exception 'knowledge topic already has an active revalidation round' using errcode='KB409';
      end if;

      select d.title, d.node_type into target_title, target_type
      from public.public_knowledge_node_declarations d
      where d.node_id = target_id
      order by d.sequence
      limit 1;
      if target_title is null or target_type is null then
        raise exception 'lineage target declaration is missing' using errcode='KB409';
      end if;
      if candidate_type <> target_type then
        raise exception 'lineage candidate must inherit the current node type' using errcode='22023';
      end if;

      -- Optimization alone may reuse the exact canonical title of its current
      -- target. Any genuinely new title and every opposition title remain global.
      if has_opposition
         or private.canonical_knowledge_title(candidate_title) <> private.canonical_knowledge_title(target_title) then
        if exists (
          select 1 from public.public_knowledge_node_declarations d
          where private.canonical_knowledge_title(d.title) = private.canonical_knowledge_title(candidate_title)
        ) then
          raise exception 'lineage candidate title already exists' using errcode='23505';
        end if;
      end if;
    end if;
    return;
  end if;

  if (item->>'type', kind) in (
    ('KnowledgeDecomposed','decompose'), ('KnowledgeMerged','merge')
  ) then return; end if;
  if item->>'type' = 'KnowledgeStatusChanged'
     and kind = 'status'
     and status in ('verified','suspended','disputed')
     and nullif(item#>>'{payload,edit,nodeId}','') is not null
     and (status <> 'suspended' or nullif(item#>>'{payload,edit,causeNodeId}','') is not null) then
    return;
  end if;
  raise exception 'event type does not match canonical knowledge command' using errcode='22023';
end $$;
revoke all on function public.validate_public_knowledge_event(jsonb) from public, anon, authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer
set search_path = public, pg_temp
as $$ select '202608220007'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
