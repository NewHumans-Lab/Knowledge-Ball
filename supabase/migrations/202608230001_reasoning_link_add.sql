-- Explicit reasoning creation: one new reasoning ball between existing nodes.
-- knowledge_dependency_edges stays the single authoritative logical DAG and the
-- existing project_knowledge_dependency_event trigger stays the single projector.

create or replace function private.validate_reasoning_link_event()
returns trigger language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=new.envelope#>'{payload,edit}';
  reasoning_id text;
  premise_ids text[];
  conclusion_ids text[];
  node_id text;
  node_type text;
  latest_verdict text;
  lineage_role text;
begin
  if new.event_type<>'KnowledgeAdded' or edit->>'mode'<>'reasoning-link' then return new; end if;
  if edit->>'kind'<>'add' then raise exception 'reasoning-link must be an add edit' using errcode='22023'; end if;

  reasoning_id:=edit#>>'{reasoning,id}';
  if nullif(reasoning_id,'') is null
     or nullif(edit#>>'{reasoning,title}','') is null
     or nullif(edit#>>'{reasoning,reasoning}','') is null
     or edit#>>'{reasoning,type}'<>'reasoning' then
    raise exception 'reasoning-link must create one named reasoning node with inference text' using errcode='22023';
  end if;
  if edit->'node' is not null or edit->'conclusion' is not null then
    raise exception 'reasoning-link cannot create premise or conclusion nodes' using errcode='22023';
  end if;
  if new.envelope#>>array['payload','declaredLayers',reasoning_id]<>'middle' then
    raise exception 'reasoning-link node must declare the rigorous reasoning layer' using errcode='22023';
  end if;
  if jsonb_typeof(edit->'requiredPremiseIds') is distinct from 'array'
     or jsonb_array_length(edit->'requiredPremiseIds')=0 then
    raise exception 'reasoning-link requires at least one existing premise' using errcode='22023';
  end if;
  if jsonb_typeof(edit->'conclusionIds') is distinct from 'array'
     or jsonb_array_length(edit->'conclusionIds')=0 then
    raise exception 'reasoning-link requires at least one existing conclusion' using errcode='22023';
  end if;

  select coalesce(array_agg(value order by ord),'{}'::text[]) into premise_ids
  from jsonb_array_elements_text(edit->'requiredPremiseIds') with ordinality x(value,ord);
  select coalesce(array_agg(value order by ord),'{}'::text[]) into conclusion_ids
  from jsonb_array_elements_text(edit->'conclusionIds') with ordinality x(value,ord);
  if cardinality(premise_ids)<>cardinality(array(select distinct unnest(premise_ids))) then
    raise exception 'reasoning-link premise ids cannot repeat' using errcode='22023';
  end if;
  if cardinality(conclusion_ids)<>cardinality(array(select distinct unnest(conclusion_ids))) then
    raise exception 'reasoning-link conclusion ids cannot repeat' using errcode='22023';
  end if;

  foreach node_id in array premise_ids loop
    if node_id=any(conclusion_ids) then
      raise exception 'a node cannot be both premise and conclusion: %',node_id using errcode='22023';
    end if;
    select d.node_type into node_type
    from public.public_knowledge_node_declarations d
    where d.node_id=node_id order by d.sequence desc limit 1;
    if node_type is null then raise exception 'reasoning-link premise does not exist: %',node_id using errcode='22023'; end if;
    if node_type='reasoning' then raise exception 'reasoning-link premise cannot be a reasoning node: %',node_id using errcode='22023'; end if;

    latest_verdict:=null;
    select r.verdict into latest_verdict
    from public.knowledge_pending_vote_rounds r
    where r.node_id=node_id
    order by r.round_no desc,r.opened_at desc limit 1;
    if latest_verdict in ('PENDING','INCORRECT') then
      raise exception 'reasoning-link premise must already be verified: %',node_id using errcode='22023';
    end if;

    lineage_role:=null;
    select lm.role into lineage_role
    from private.knowledge_lineage_members lm where lm.node_id=node_id;
    if lineage_role is not null and lineage_role<>'current' then
      raise exception 'reasoning-link premise must be the current lineage node: %',node_id using errcode='22023';
    end if;
  end loop;

  foreach node_id in array conclusion_ids loop
    select d.node_type into node_type
    from public.public_knowledge_node_declarations d
    where d.node_id=node_id order by d.sequence desc limit 1;
    if node_type is null then raise exception 'reasoning-link conclusion does not exist: %',node_id using errcode='22023'; end if;
    if node_type='reasoning' then raise exception 'reasoning-link conclusion cannot be a reasoning node: %',node_id using errcode='22023'; end if;
  end loop;
  return new;
end $$;
revoke all on function private.validate_reasoning_link_event() from public,anon,authenticated;

drop trigger if exists ac_validate_reasoning_link_event on public.public_knowledge_events;
create trigger ac_validate_reasoning_link_event before insert on public.public_knowledge_events
for each row execute function private.validate_reasoning_link_event();

create or replace function private.project_reasoning_link_event_values(envelope_value jsonb)
returns void language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=envelope_value#>'{payload,edit}';
  reasoning_id text;
  premise_ids text[];
  conclusion_ids text[];
  conclusion_id text;
  rewritten text[];
begin
  if edit->>'mode'<>'reasoning-link' then return; end if;
  reasoning_id:=edit#>>'{reasoning,id}';
  select coalesce(array_agg(value order by ord),'{}'::text[]) into premise_ids
  from jsonb_array_elements_text(edit->'requiredPremiseIds') with ordinality x(value,ord);
  select coalesce(array_agg(value order by ord),'{}'::text[]) into conclusion_ids
  from jsonb_array_elements_text(edit->'conclusionIds') with ordinality x(value,ord);

  perform private.replace_knowledge_dependencies(reasoning_id,premise_ids);
  foreach conclusion_id in array conclusion_ids loop
    select coalesce(array_agg(distinct premise_node_id order by premise_node_id),'{}'::text[]) into rewritten
    from private.knowledge_dependency_edges where conclusion_node_id=conclusion_id;
    rewritten:=array(select distinct unnest(rewritten||array[reasoning_id]) order by 1);
    perform private.replace_knowledge_dependencies(conclusion_id,rewritten);
  end loop;
end $$;
revoke all on function private.project_reasoning_link_event_values(jsonb) from public,anon,authenticated;

-- Extend the existing single DAG projection trigger rather than adding a second
-- competing after-insert projector. Legacy modes keep using project_dependency_event;
-- only the new reasoning-link delta is appended afterward.
create or replace function private.project_knowledge_dependency_event()
returns trigger language plpgsql security definer
set search_path=private,public,pg_temp
as $$
begin
  perform private.project_dependency_event(new.event_type,new.envelope);
  if new.event_type='KnowledgeAdded' and new.envelope#>>'{payload,edit,mode}'='reasoning-link' then
    perform private.project_reasoning_link_event_values(new.envelope);
  end if;
  return new;
end $$;
revoke all on function private.project_knowledge_dependency_event() from public,anon,authenticated;

drop trigger if exists project_reasoning_link_event on public.public_knowledge_events;

-- Deterministic replay for databases that may already contain reasoning-link events.
do $$
declare item record;
begin
  for item in select envelope from public.public_knowledge_events
    where event_type='KnowledgeAdded' and envelope#>>'{payload,edit,mode}'='reasoning-link'
    order by sequence,event_id
  loop
    perform private.project_reasoning_link_event_values(item.envelope);
  end loop;
end $$;

create or replace function public.knowledge_ball_schema_version()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select '202608230001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;