-- Fix the hosted reasoning-link validator discovered by a real transaction probe.
-- The original local variable `node_id` collided with declaration column names
-- under PL/pgSQL variable/column ambiguity rules. Keep migration 001 immutable and
-- repair the deployed function with an unambiguous variable name.

create or replace function private.validate_reasoning_link_event()
returns trigger language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=new.envelope#>'{payload,edit}';
  reasoning_id text;
  premise_ids text[];
  conclusion_ids text[];
  candidate_node_id text;
  candidate_node_type text;
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

  foreach candidate_node_id in array premise_ids loop
    if candidate_node_id=any(conclusion_ids) then
      raise exception 'a node cannot be both premise and conclusion: %',candidate_node_id using errcode='22023';
    end if;
    candidate_node_type:=null;
    select d.node_type into candidate_node_type
    from public.public_knowledge_node_declarations d
    where d.node_id=candidate_node_id order by d.sequence desc limit 1;
    if candidate_node_type is null then
      raise exception 'reasoning-link premise does not exist: %',candidate_node_id using errcode='22023';
    end if;
    if candidate_node_type='reasoning' then
      raise exception 'reasoning-link premise cannot be a reasoning node: %',candidate_node_id using errcode='22023';
    end if;

    latest_verdict:=null;
    select r.verdict into latest_verdict
    from public.knowledge_pending_vote_rounds r
    where r.node_id=candidate_node_id
    order by r.round_no desc,r.opened_at desc limit 1;
    if latest_verdict in ('PENDING','INCORRECT') then
      raise exception 'reasoning-link premise must already be verified: %',candidate_node_id using errcode='22023';
    end if;

    lineage_role:=null;
    select lm.role into lineage_role
    from private.knowledge_lineage_members lm where lm.node_id=candidate_node_id;
    if lineage_role is not null and lineage_role<>'current' then
      raise exception 'reasoning-link premise must be the current lineage node: %',candidate_node_id using errcode='22023';
    end if;
  end loop;

  foreach candidate_node_id in array conclusion_ids loop
    candidate_node_type:=null;
    select d.node_type into candidate_node_type
    from public.public_knowledge_node_declarations d
    where d.node_id=candidate_node_id order by d.sequence desc limit 1;
    if candidate_node_type is null then
      raise exception 'reasoning-link conclusion does not exist: %',candidate_node_id using errcode='22023';
    end if;
    if candidate_node_type='reasoning' then
      raise exception 'reasoning-link conclusion cannot be a reasoning node: %',candidate_node_id using errcode='22023';
    end if;
  end loop;
  return new;
end $$;
revoke all on function private.validate_reasoning_link_event() from public,anon,authenticated;

create or replace function public.knowledge_ball_schema_version()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select '202608230002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;