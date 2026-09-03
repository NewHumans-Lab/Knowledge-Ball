-- Remove the retired knowledge-decomposition operation from the current hosted
-- schema. Historical migration files remain immutable; this forward migration
-- removes persisted decomposition events, rebuilds the derived dependency DAG
-- from the remaining event stream, and closes every current server write path.

-- The retired event never owned sequence continuity. Preserve all surviving
-- event sequence values exactly as written; gaps are valid append-only history.
delete from public.public_knowledge_events
where event_type = 'KnowledgeDecomposed'
   or envelope #>> '{payload,edit,kind}' = 'decompose';

-- The current event-type whitelist no longer recognizes the retired event.
alter table public.public_knowledge_events
  drop constraint if exists public_knowledge_events_event_type_check;
alter table public.public_knowledge_events
  add constraint public_knowledge_events_event_type_check
  check(event_type in (
    'NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved',
    'KnowledgeAdded','KnowledgeNegated','KnowledgeMerged','KnowledgeStatusChanged',
    'KnowledgeNodeEdited','KnowledgeVerdictFinalized','KnowledgeRevalidationStarted','KnowledgeRevalidationFinalized'
  ));

-- Keep the authoritative DAG projector identical for all surviving event
-- families while removing the retired decomposition branch completely.
create or replace function private.project_dependency_event(
  event_type_value text,
  envelope_value jsonb
) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  edit jsonb := envelope_value #> '{payload,edit}';
  target_id text;
  candidate_id text;
  premise_ids text[];
  source_ids text[];
  first_chain jsonb;
begin
  if event_type_value = 'KnowledgeDecomposed'
     or edit ->> 'kind' = 'decompose' then
    raise exception 'knowledge decomposition is not supported' using errcode = '22023';
  end if;

  -- Legacy imported node event.
  if event_type_value = 'NodeCreated' then
    target_id := envelope_value #>> '{payload,nodeId}';
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into premise_ids
    from jsonb_array_elements_text(coalesce(envelope_value #> '{payload,premises}', '[]'::jsonb))
      with ordinality x(value, ord);
    perform private.replace_knowledge_dependencies(target_id, premise_ids);
    return;
  end if;

  if event_type_value = 'NodeEdited' and envelope_value #> '{payload,premises}' is not null then
    target_id := envelope_value #>> '{payload,nodeId}';
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into premise_ids
    from jsonb_array_elements_text(envelope_value #> '{payload,premises}')
      with ordinality x(value, ord);
    perform private.replace_knowledge_dependencies(target_id, premise_ids);
    return;
  end if;

  if event_type_value = 'KnowledgeAdded' then
    -- Immutable optimization/opposition candidates inherit the target ball's
    -- logical premises; lineage itself is never represented as a DAG edge.
    if envelope_value #> '{payload,optimization}' is not null then
      candidate_id := edit #>> '{node,id}';
      target_id := envelope_value #>> '{payload,optimization,targetId}';
      select coalesce(array_agg(premise_node_id order by premise_node_id), '{}'::text[])
      into premise_ids
      from private.knowledge_dependency_edges
      where conclusion_node_id = target_id;
      perform private.replace_knowledge_dependencies(candidate_id, premise_ids);
      return;
    end if;

    if envelope_value #> '{payload,opposition}' is not null then
      candidate_id := edit #>> '{node,id}';
      target_id := envelope_value #>> '{payload,opposition,targetId}';
      select coalesce(array_agg(premise_node_id order by premise_node_id), '{}'::text[])
      into premise_ids
      from private.knowledge_dependency_edges
      where conclusion_node_id = target_id;
      perform private.replace_knowledge_dependencies(candidate_id, premise_ids);
      return;
    end if;

    if edit ->> 'mode' = 'atomic' then
      perform private.replace_knowledge_dependencies(edit #>> '{node,id}', '{}'::text[]);
      return;
    end if;

    if edit ->> 'mode' = 'theory' then
      select coalesce(array_agg(value order by ord), '{}'::text[])
      into premise_ids
      from jsonb_array_elements_text(coalesce(edit -> 'requiredPremiseIds', '[]'::jsonb))
        with ordinality x(value, ord);
      perform private.replace_knowledge_dependencies(edit #>> '{reasoning,id}', premise_ids);
      perform private.replace_knowledge_dependencies(
        edit #>> '{conclusion,id}',
        array[edit #>> '{reasoning,id}']
      );
      return;
    end if;
  end if;

  if event_type_value = 'KnowledgeNodeEdited' and edit -> 'premises' is not null then
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into premise_ids
    from jsonb_array_elements_text(edit -> 'premises') with ordinality x(value, ord);
    perform private.replace_knowledge_dependencies(edit ->> 'nodeId', premise_ids);
    return;
  end if;

  -- Existing negate(reasoning) semantics create one corrected immutable
  -- reasoning node and repoint downstream premise references to it.
  if event_type_value = 'KnowledgeNegated'
     and edit ->> 'target' = 'reasoning'
     and edit -> 'correctedReasoning' is not null then
    target_id := edit ->> 'targetId';
    candidate_id := edit #>> '{correctedReasoning,id}';
    select coalesce(array_agg(premise_node_id order by premise_node_id), '{}'::text[])
    into premise_ids
    from private.knowledge_dependency_edges
    where conclusion_node_id = target_id;
    perform private.replace_knowledge_dependencies(candidate_id, premise_ids);
    perform private.repoint_dependency_sources(array[target_id], candidate_id);
    return;
  end if;

  if event_type_value = 'KnowledgeMerged' and edit ->> 'mode' = 'definition' then
    perform private.replace_knowledge_dependencies(edit #>> '{mergedDefinition,id}', '{}'::text[]);
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into source_ids
    from jsonb_array_elements_text(coalesce(edit -> 'sourceNodeIds', '[]'::jsonb))
      with ordinality x(value, ord);
    perform private.repoint_dependency_sources(source_ids, edit #>> '{mergedDefinition,id}');
    return;
  end if;

  if event_type_value = 'KnowledgeMerged' and edit ->> 'mode' = 'theory' then
    first_chain := (edit -> 'chains') -> 0;
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into premise_ids
    from jsonb_array_elements_text(coalesce(first_chain -> 'premiseIds', '[]'::jsonb))
      with ordinality x(value, ord);
    perform private.replace_knowledge_dependencies(edit #>> '{mergedReasoning,id}', premise_ids);
    perform private.replace_knowledge_dependencies(
      edit #>> '{mergedConclusion,id}',
      array[edit #>> '{mergedReasoning,id}']
    );
    select coalesce(array_agg(value ->> 'conclusionId' order by ord), '{}'::text[])
    into source_ids
    from jsonb_array_elements(coalesce(edit -> 'chains', '[]'::jsonb))
      with ordinality x(value, ord);
    perform private.repoint_dependency_sources(source_ids, edit #>> '{mergedConclusion,id}');
    return;
  end if;
end $$;

revoke all on function private.project_dependency_event(text, jsonb)
from public, anon, authenticated;

-- Rebuild the derived DAG from surviving authoritative events. This removes
-- every dependency edge that existed only because of a deleted decomposition
-- event while deterministically preserving all surviving event semantics.
delete from private.knowledge_dependency_edges;
do $$
declare
  item record;
begin
  for item in
    select event_type, envelope
    from public.public_knowledge_events
    order by sequence, event_id
  loop
    perform private.project_dependency_event(item.event_type, item.envelope);
    if item.event_type = 'KnowledgeAdded'
       and item.envelope #>> '{payload,edit,kind}' = 'add'
       and item.envelope #>> '{payload,edit,mode}' = 'reasoning-link' then
      perform private.project_reasoning_link_event_values(item.event_type, item.envelope);
    end if;
  end loop;
end $$;

-- Pending-node eligibility must not treat the removed operation as a retirement
-- transition. All surviving behavior is unchanged.
create or replace function public.is_pending_knowledge_node(target_node_id text) returns boolean
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare born_at bigint;
begin
  if nullif(target_node_id, '') is null then return false; end if;

  select min(sequence) into born_at
  from public.public_knowledge_events
  where
    (event_type = 'KnowledgeAdded' and (
      envelope#>>'{payload,edit,node,id}' = target_node_id
      or envelope#>>'{payload,edit,reasoning,id}' = target_node_id
      or envelope#>>'{payload,edit,conclusion,id}' = target_node_id
    ))
    or (event_type = 'NodeCreated'
      and envelope#>>'{payload,nodeId}' = target_node_id
      and coalesce(envelope#>>'{payload,initialStatus}', 'pending') = 'pending');

  if born_at is null then return false; end if;

  return not exists (
    select 1 from public.public_knowledge_events event
    where event.sequence > born_at and (
      (event.event_type = 'KnowledgeStatusChanged'
        and event.envelope#>>'{payload,edit,nodeId}' = target_node_id
        and event.envelope#>>'{payload,edit,status}' in ('verified','suspended','disputed'))
      or (event.event_type = 'KnowledgeNegated'
        and event.envelope#>>'{payload,edit,targetId}' = target_node_id)
      or (event.event_type in ('NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved')
        and event.envelope#>>'{payload,nodeId}' = target_node_id)
      or (event.event_type = 'KnowledgeMerged' and (
        coalesce(event.envelope#>'{payload,edit,sourceNodeIds}', '[]'::jsonb) ? target_node_id
        or exists (
          select 1 from jsonb_array_elements(coalesce(event.envelope#>'{payload,edit,chains}', '[]'::jsonb)) chain
          where chain->>'reasoningId' = target_node_id or chain->>'conclusionId' = target_node_id
        )
      ))
    )
  );
end $$;

-- Preserve the current Lineage V3 authority/identity contract exactly while
-- rejecting the retired operation before any other command classification.
create or replace function public.validate_public_knowledge_event(item jsonb)
returns void
language plpgsql stable
set search_path=public,private,pg_temp
as $$
declare
  kind text:=item#>>'{payload,edit,kind}';
  layers jsonb:=item#>'{payload,declaredLayers}';
  added_node_ids text[]:='{}';
  added_node_id text;
  layer_key text;
  declared_layer text;
  target_node_id text;
  lineage_topic_id text;
  candidate_title text;
  candidate_type text;
  candidate_logic_rule_id text;
  target_title text;
  target_type text;
  target_logic_rule_id text;
  target_row private.knowledge_lineage_members%rowtype;
  has_optimization boolean:=item#>'{payload,optimization}' is not null;
  has_opposition boolean:=item#>'{payload,opposition}' is not null;
begin
  if item->>'type'='KnowledgeDecomposed' or kind='decompose' then
    raise exception 'knowledge decomposition is not supported' using errcode='22023';
  end if;

  if jsonb_path_exists(item,'$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode='22023';
  end if;
  if item->>'type' in (
    'KnowledgeVerdictFinalized',
    'KnowledgeRevalidationStarted',
    'KnowledgeRevalidationFinalized',
    'KnowledgeStatusChanged'
  ) then
    raise exception 'public truth lifecycle/status events are server-only' using errcode='42501';
  end if;
  if item->>'type'='KnowledgeNodeEdited' then
    raise exception 'immutable knowledge balls cannot be edited in place; submit an optimization candidate' using errcode='22023';
  end if;
  if item->>'type'='KnowledgeNegated' then
    raise exception 'legacy negation is read-only; submit an opposition candidate' using errcode='22023';
  end if;

  if item->>'type'='KnowledgeAdded' and kind='add' then
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
      if added_node_id=any(added_node_ids) then
        raise exception 'KnowledgeAdded contains duplicate created node id: %',added_node_id using errcode='22023';
      end if;
      added_node_ids:=array_append(added_node_ids,added_node_id);
      declared_layer:=layers->>added_node_id;
      if declared_layer is null or not exists (
        select 1 from public.knowledge_layer_definitions d
        where d.layer_code=declared_layer
      ) then
        raise exception 'KnowledgeAdded node % must declare inner, middle, or outer',added_node_id using errcode='22023';
      end if;
    end loop;

    if cardinality(added_node_ids)=0 then
      raise exception 'KnowledgeAdded must create at least one node' using errcode='22023';
    end if;
    for layer_key in select jsonb_object_keys(layers) loop
      if not (layer_key=any(added_node_ids)) then
        raise exception 'declaredLayers contains a node not created by this event: %',layer_key using errcode='22023';
      end if;
    end loop;

    if has_optimization and has_opposition then
      raise exception 'KnowledgeAdded cannot be optimization and opposition simultaneously' using errcode='22023';
    end if;

    if has_optimization or has_opposition then
      if item#>>'{payload,edit,mode}'<>'atomic' or cardinality(added_node_ids)<>1 then
        raise exception 'lineage head-change candidate must be one atomic immutable node' using errcode='22023';
      end if;

      target_node_id:=case when has_optimization
        then item#>>'{payload,optimization,targetId}'
        else item#>>'{payload,opposition,targetId}' end;
      lineage_topic_id:=case when has_optimization
        then item#>>'{payload,optimization,topicId}'
        else item#>>'{payload,opposition,topicId}' end;
      candidate_title:=item#>>'{payload,edit,node,title}';
      candidate_type:=item#>>'{payload,edit,node,type}';
      candidate_logic_rule_id:=item#>>'{payload,edit,node,logicRuleId}';

      if nullif(target_node_id,'') is null
         or nullif(lineage_topic_id,'') is null
         or nullif(candidate_title,'') is null
         or nullif(candidate_type,'') is null then
        raise exception 'lineage candidate requires targetId, topicId, title and type' using errcode='22023';
      end if;

      select lm.* into target_row
      from private.knowledge_lineage_members lm
      where lm.node_id=target_node_id;
      if not found
         or target_row.role<>'current'
         or target_row.topic_id<>lineage_topic_id
         or target_row.revalidating then
        raise exception 'lineage candidate target is not the stable current head' using errcode='KB409';
      end if;

      if exists (
        select 1 from private.knowledge_lineage_members lm
        where lm.topic_id=lineage_topic_id
          and lm.role in ('candidate-history','candidate-opposition')
      ) then
        raise exception 'knowledge topic already has a pending head-change candidate' using errcode='KB409';
      end if;
      if exists (
        select 1 from private.knowledge_revalidation_rounds rr
        where rr.topic_id=lineage_topic_id and rr.verdict='PENDING'
      ) then
        raise exception 'knowledge topic already has an active revalidation round' using errcode='KB409';
      end if;

      select d.title,d.node_type into target_title,target_type
      from public.public_knowledge_node_declarations d
      where d.node_id=target_node_id
      order by d.sequence
      limit 1;
      if target_title is null or target_type is null then
        raise exception 'lineage target declaration is missing' using errcode='KB409';
      end if;
      if candidate_type<>target_type then
        raise exception 'lineage candidate must inherit the current node type' using errcode='22023';
      end if;

      target_logic_rule_id:=private.knowledge_node_logic_rule(target_node_id);
      if candidate_logic_rule_id is distinct from target_logic_rule_id then
        raise exception 'lineage candidate must inherit the current logic-rule identity' using errcode='22023';
      end if;

      -- Optimization may keep the exact canonical title of its current target.
      -- Every opposition title and every genuinely new optimization title remains
      -- globally unique under the NFKC canonicalizer.
      if has_opposition
         or private.canonical_knowledge_title(candidate_title)
            <>private.canonical_knowledge_title(target_title) then
        if exists (
          select 1 from public.public_knowledge_node_declarations d
          where private.canonical_knowledge_title(d.title)
                =private.canonical_knowledge_title(candidate_title)
        ) then
          raise exception 'lineage candidate title already exists' using errcode='23505';
        end if;
      end if;
    end if;
    return;
  end if;

  if (item->>'type',kind) = ('KnowledgeMerged','merge') then
    return;
  end if;

  raise exception 'event type does not match canonical knowledge command' using errcode='22023';
end $$;
revoke all on function public.validate_public_knowledge_event(jsonb)
from public,anon,authenticated;

create or replace function public.knowledge_ball_schema_version()
returns text
language sql stable security definer
set search_path=public,pg_temp
as $$ select '202609030002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
