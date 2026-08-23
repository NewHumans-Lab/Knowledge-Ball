-- Reasoning identity is structural: one premise-topic set + one conclusion-topic
-- set identifies one current reasoning topic, independent of title/prose.
-- Reasoning optimization may only change title and inference prose; structure and
-- declared layer remain inherited from the current version.

create or replace function private.reasoning_endpoint_topic(node_id_value text)
returns text
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  select coalesce(
    (select lm.topic_id from private.knowledge_lineage_members lm where lm.node_id=node_id_value),
    node_id_value
  )
$$;
revoke all on function private.reasoning_endpoint_topic(text) from public,anon,authenticated;

create or replace function private.validate_unique_reasoning_identity()
returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=new.envelope#>'{payload,edit}';
  premise_topics text[];
  conclusion_topics text[];
  identity_key text;
  duplicate_reasoning_id text;
  duplicate_reasoning_title text;
begin
  if new.event_type<>'KnowledgeAdded' or edit->>'mode'<>'reasoning-link' then
    return new;
  end if;

  select coalesce(array_agg(distinct private.reasoning_endpoint_topic(value) order by private.reasoning_endpoint_topic(value)),'{}'::text[])
  into premise_topics
  from jsonb_array_elements_text(edit->'requiredPremiseIds') x(value);

  select coalesce(array_agg(distinct private.reasoning_endpoint_topic(value) order by private.reasoning_endpoint_topic(value)),'{}'::text[])
  into conclusion_topics
  from jsonb_array_elements_text(edit->'conclusionIds') x(value);

  identity_key:=array_to_string(premise_topics,E'\x1f')||E'\x1e'||array_to_string(conclusion_topics,E'\x1f');
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
    select coalesce(array_agg(distinct private.reasoning_endpoint_topic(e.premise_node_id) order by private.reasoning_endpoint_topic(e.premise_node_id)),'{}'::text[])
    from private.knowledge_dependency_edges e
    where e.conclusion_node_id=r.node_id
  )=premise_topics
    and (
      select coalesce(array_agg(distinct private.reasoning_endpoint_topic(e.conclusion_node_id) order by private.reasoning_endpoint_topic(e.conclusion_node_id)),'{}'::text[])
      from private.knowledge_dependency_edges e
      where e.premise_node_id=r.node_id
    )=conclusion_topics
  order by r.node_id
  limit 1;

  if duplicate_reasoning_id is not null then
    raise exception '推理节点已存在：%（同样的前提与结论只能有一个推理节点）',coalesce(duplicate_reasoning_title,duplicate_reasoning_id)
      using errcode='23505',detail=format('existing_reasoning_id=%s',duplicate_reasoning_id);
  end if;

  return new;
end $$;
revoke all on function private.validate_unique_reasoning_identity() from public,anon,authenticated;

drop trigger if exists ad_validate_unique_reasoning_identity on public.public_knowledge_events;
create trigger ad_validate_unique_reasoning_identity
before insert on public.public_knowledge_events
for each row execute function private.validate_unique_reasoning_identity();

create or replace function private.validate_reasoning_optimization_fields()
returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  edit jsonb:=new.envelope#>'{payload,edit}';
  target_id text:=new.envelope#>>'{payload,optimization,targetId}';
  candidate_id text:=edit#>>'{node,id}';
  target_type text;
  target_layer text;
  candidate_layer text;
begin
  if new.event_type<>'KnowledgeAdded' or new.envelope#>'{payload,optimization}' is null then
    return new;
  end if;

  select d.node_type,d.declared_layer
  into target_type,target_layer
  from public.public_knowledge_node_declarations d
  where d.node_id=target_id
  order by d.sequence desc
  limit 1;

  if target_type<>'reasoning' then
    return new;
  end if;

  candidate_layer:=new.envelope#>>array['payload','declaredLayers',candidate_id];
  if target_layer is not null and candidate_layer is distinct from target_layer then
    raise exception '推理节点优化只能修改名字和推理过程，知识层级必须保持不变'
      using errcode='22023';
  end if;

  if edit->>'mode'<>'atomic'
     or edit#>>'{node,type}'<>'reasoning'
     or (edit - 'kind' - 'mode' - 'node')<>'{}'::jsonb
     or ((edit->'node') - 'id' - 'title' - 'type' - 'reasoning' - 'logicRuleId')<>'{}'::jsonb then
    raise exception '推理节点优化只能提交名字和推理过程；前提、结论、类型和逻辑结构必须继承当前节点'
      using errcode='22023';
  end if;

  return new;
end $$;
revoke all on function private.validate_reasoning_optimization_fields() from public,anon,authenticated;

drop trigger if exists ae_validate_reasoning_optimization_fields on public.public_knowledge_events;
create trigger ae_validate_reasoning_optimization_fields
before insert on public.public_knowledge_events
for each row execute function private.validate_reasoning_optimization_fields();

create or replace function public.knowledge_ball_schema_version()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select '202608230003'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
