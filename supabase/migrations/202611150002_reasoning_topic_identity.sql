-- Reasoning identity is one premise-topic set plus one conclusion topic.
-- A conclusion optimization changes the concrete Current ball, not the logical
-- relationship. Historical endpoint IDs must therefore deduplicate by topic.
create or replace function private.validate_unique_reasoning_identity()
returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=new.envelope#>'{payload,edit}';
  premise_topics text[];
  conclusion_topic text;
  identity_key text;
  duplicate_reasoning_id text;
  duplicate_reasoning_title text;
begin
  if new.event_type<>'KnowledgeAdded' or edit->>'mode'<>'reasoning-link' then
    return new;
  end if;

  if jsonb_typeof(edit->'conclusionIds') is distinct from 'array'
     or jsonb_array_length(edit->'conclusionIds')<>1 then
    raise exception '新增推理必须且只能选择一个已有结论'
      using errcode='22023';
  end if;

  select private.reasoning_endpoint_topic(edit#>>'{conclusionIds,0}')
  into conclusion_topic;
  if conclusion_topic is null or btrim(conclusion_topic)='' then
    raise exception '新增推理必须且只能选择一个已有结论'
      using errcode='22023';
  end if;

  select coalesce(
    array_agg(distinct private.reasoning_endpoint_topic(value)
      order by private.reasoning_endpoint_topic(value)),
    '{}'::text[]
  )
  into premise_topics
  from jsonb_array_elements_text(edit->'requiredPremiseIds') x(value);

  identity_key:=array_to_string(premise_topics,E'\x1f')||E'\x1e'||conclusion_topic;
  perform pg_advisory_xact_lock(hashtextextended(identity_key,0));

  with latest_declaration as (
    select distinct on (d.node_id)
      d.node_id,d.node_type,d.title
    from public.public_knowledge_node_declarations d
    order by d.node_id,d.sequence desc
  ), current_reasoning as (
    select d.node_id,d.title
    from latest_declaration d
    left join private.knowledge_lineage_members lm on lm.node_id=d.node_id
    where d.node_type='reasoning'
      and (lm.node_id is null or lm.role='current')
  )
  select r.node_id,r.title
  into duplicate_reasoning_id,duplicate_reasoning_title
  from current_reasoning r
  where (
    select coalesce(
      array_agg(distinct private.reasoning_endpoint_topic(e.premise_node_id)
        order by private.reasoning_endpoint_topic(e.premise_node_id)),
      '{}'::text[]
    )
    from private.knowledge_dependency_edges e
    where e.conclusion_node_id=r.node_id
  )=premise_topics
    and exists (
      select 1
      from private.knowledge_dependency_edges e
      where e.premise_node_id=r.node_id
        and private.reasoning_endpoint_topic(e.conclusion_node_id)=conclusion_topic
    )
  order by r.node_id
  limit 1;

  if duplicate_reasoning_id is not null then
    raise exception '推理节点已存在：%（同样的前提与结论主题只能有一个推理节点）',coalesce(duplicate_reasoning_title,duplicate_reasoning_id)
      using errcode='23505',detail=format('existing_reasoning_id=%s',duplicate_reasoning_id);
  end if;

  return new;
end $$;
revoke all on function private.validate_unique_reasoning_identity() from public,anon,authenticated;

create or replace function public.knowledge_ball_schema_version()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select '202611150002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
