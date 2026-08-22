-- Knowledge Lineage V3 / module 6 (part 1): authoritative premise DAG.
--
-- This projection contains LOGICAL premise -> conclusion edges only. Lineage
-- history/opposition relations are intentionally excluded. The graph is kept
-- acyclic at write time and is rebuilt deterministically from public events.

create table private.knowledge_dependency_edges (
  premise_node_id text not null,
  conclusion_node_id text not null,
  created_at timestamptz not null default now(),
  primary key (premise_node_id, conclusion_node_id),
  check (premise_node_id <> conclusion_node_id)
);

create index knowledge_dependency_edges_conclusion
  on private.knowledge_dependency_edges(conclusion_node_id, premise_node_id);

alter table private.knowledge_dependency_edges enable row level security;
revoke all on private.knowledge_dependency_edges from public, anon, authenticated;

create or replace function private.replace_knowledge_dependencies(
  target_node_id text,
  premise_ids text[]
) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  premise_id text;
begin
  if nullif(target_node_id, '') is null then
    raise exception 'dependency target id required' using errcode = '22023';
  end if;

  delete from private.knowledge_dependency_edges
  where conclusion_node_id = target_node_id;

  foreach premise_id in array coalesce(premise_ids, '{}'::text[])
  loop
    if nullif(premise_id, '') is null then continue; end if;
    if premise_id = target_node_id then
      raise exception 'knowledge dependency cannot reference itself' using errcode = '23514';
    end if;

    -- Adding premise -> target would create a cycle exactly when target can
    -- already reach premise through existing premise -> conclusion edges.
    if exists (
      with recursive downstream(node_id) as (
        select e.conclusion_node_id
        from private.knowledge_dependency_edges e
        where e.premise_node_id = target_node_id
        union
        select e.conclusion_node_id
        from private.knowledge_dependency_edges e
        join downstream d on e.premise_node_id = d.node_id
      )
      select 1 from downstream where node_id = premise_id
    ) then
      raise exception 'knowledge dependency graph must remain acyclic' using errcode = '23514';
    end if;

    insert into private.knowledge_dependency_edges(premise_node_id, conclusion_node_id)
    values (premise_id, target_node_id)
    on conflict do nothing;
  end loop;
end $$;

create or replace function private.repoint_dependency_sources(
  source_ids text[],
  replacement_id text
) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  affected_id text;
  rewritten text[];
begin
  if nullif(replacement_id, '') is null then
    raise exception 'dependency replacement id required' using errcode = '22023';
  end if;

  for affected_id in
    select distinct conclusion_node_id
    from private.knowledge_dependency_edges
    where premise_node_id = any(coalesce(source_ids, '{}'::text[]))
      and conclusion_node_id <> replacement_id
    order by conclusion_node_id
  loop
    select coalesce(array_agg(distinct mapped order by mapped), '{}'::text[])
    into rewritten
    from (
      select case
        when premise_node_id = any(source_ids) then replacement_id
        else premise_node_id
      end as mapped
      from private.knowledge_dependency_edges
      where conclusion_node_id = affected_id
    ) q;

    perform private.replace_knowledge_dependencies(affected_id, rewritten);
  end loop;
end $$;

revoke all on function private.replace_knowledge_dependencies(text, text[]),
  private.repoint_dependency_sources(text[], text)
from public, anon, authenticated;

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
  current_premises text[];
  step jsonb;
  intermediate jsonb;
  final_reasoning_id text;
  step_index integer := 0;
  first_chain jsonb;
begin
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

  if event_type_value = 'KnowledgeDecomposed' then
    select coalesce(array_agg(value order by ord), '{}'::text[])
    into current_premises
    from jsonb_array_elements_text(coalesce(edit #> '{chain,premiseIds}', '[]'::jsonb))
      with ordinality x(value, ord);

    step_index := 0;
    for step in
      select value from jsonb_array_elements(coalesce(edit -> 'reasoningSteps', '[]'::jsonb))
    loop
      perform private.replace_knowledge_dependencies(step ->> 'id', current_premises);
      intermediate := (edit -> 'intermediateConclusions') -> step_index;
      if intermediate is not null then
        perform private.replace_knowledge_dependencies(intermediate ->> 'id', array[step ->> 'id']);
        current_premises := array[intermediate ->> 'id'];
      end if;
      final_reasoning_id := step ->> 'id';
      step_index := step_index + 1;
    end loop;

    if final_reasoning_id is not null then
      target_id := edit #>> '{chain,conclusionId}';
      select coalesce(array_agg(mapped order by mapped), '{}'::text[])
      into premise_ids
      from (
        select distinct case
          when premise_node_id = edit #>> '{chain,reasoningId}' then final_reasoning_id
          else premise_node_id
        end as mapped
        from private.knowledge_dependency_edges
        where conclusion_node_id = target_id
      ) q;
      perform private.replace_knowledge_dependencies(target_id, premise_ids);
    end if;
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

-- Reconstruct the current effective premise DAG from the append-only history.
do $$
declare
  item record;
begin
  for item in
    select event_type, envelope
    from public.public_knowledge_events
    order by seq, event_id
  loop
    perform private.project_dependency_event(item.event_type, item.envelope);
  end loop;
end $$;

create or replace function private.project_knowledge_dependency_event() returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
begin
  perform private.project_dependency_event(new.event_type, new.envelope);
  return new;
end $$;
revoke all on function private.project_knowledge_dependency_event()
from public, anon, authenticated;

drop trigger if exists project_knowledge_dependency_event on public.public_knowledge_events;
create trigger project_knowledge_dependency_event
after insert on public.public_knowledge_events
for each row execute function private.project_knowledge_dependency_event();
