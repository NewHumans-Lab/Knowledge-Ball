-- Canonical three-layer knowledge classification contract.
--
-- Public knowledge remains event sourced in public_knowledge_events. This migration
-- deliberately does NOT introduce three independently writable knowledge tables:
-- that would create multiple sources of truth and make moves/reclassification
-- non-atomic. Instead, the event stream stays authoritative while one definition
-- table and read-only projection views expose the three layers for inspection,
-- bulk replacement preparation, analytics and future import tooling.
--
-- Existing historical events are not rewritten or backfilled. New KnowledgeAdded
-- events must explicitly declare one canonical layer for every node they create.

create table if not exists public.knowledge_layer_definitions (
  layer_code text primary key check (layer_code in ('inner', 'middle', 'outer')),
  ordinal smallint not null unique check (ordinal between 1 and 3),
  label text not null,
  definition text not null,
  updated_at timestamptz not null default now()
);

insert into public.knowledge_layer_definitions(layer_code, ordinal, label, definition)
values
  (
    'inner',
    1,
    '第一层 · 语义与基础事实',
    '定义、直接事实或观察，以及知识点之间不依赖推导的静态语义关系。第一层描述“是什么 / 有什么关系”，不是推理链。'
  ),
  (
    'middle',
    2,
    '第二层 · 严谨推理',
    '所有严谨推理，或明确声称严谨的推理结构，包括公理体系、证明、定理、演绎规则和形式化推导。'
  ),
  (
    'outer',
    3,
    '第三层 · 概率与争议',
    '有争议的知识，或作者提交时明确声明为概率性或不确定性的描述，例如“可能”“也许”、明确概率、假说、预测、观点和价值判断。'
  )
on conflict(layer_code) do update
set ordinal = excluded.ordinal,
    label = excluded.label,
    definition = excluded.definition,
    updated_at = now();

revoke all on table public.knowledge_layer_definitions from public, anon, authenticated;
grant select on table public.knowledge_layer_definitions to authenticated;

-- One normalized, read-only projection of node declarations from the canonical
-- event stream. Historical rows without explicit declaredLayers remain visible
-- here with declared_layer = NULL, but are intentionally excluded from the three
-- canonical layer views below. This preserves audit history without pretending old
-- data conforms to the new clean-data contract.
create or replace view public.public_knowledge_node_declarations
with (security_invoker = true)
as
select
  e.sequence,
  e.event_id,
  n.node_id,
  e.envelope->'payload'->'declaredLayers'->>n.node_id as declared_layer,
  n.node_type,
  n.title,
  n.description,
  e.actor_id,
  e.created_at
from public.public_knowledge_events e
cross join lateral (
  values
    (
      e.envelope#>>'{payload,edit,node,id}',
      e.envelope#>>'{payload,edit,node,type}',
      e.envelope#>>'{payload,edit,node,title}',
      e.envelope#>>'{payload,edit,node,reasoning}'
    ),
    (
      e.envelope#>>'{payload,edit,reasoning,id}',
      e.envelope#>>'{payload,edit,reasoning,type}',
      e.envelope#>>'{payload,edit,reasoning,title}',
      e.envelope#>>'{payload,edit,reasoning,reasoning}'
    ),
    (
      e.envelope#>>'{payload,edit,conclusion,id}',
      e.envelope#>>'{payload,edit,conclusion,type}',
      e.envelope#>>'{payload,edit,conclusion,title}',
      e.envelope#>>'{payload,edit,conclusion,reasoning}'
    )
) as n(node_id, node_type, title, description)
where e.event_type = 'KnowledgeAdded'
  and nullif(n.node_id, '') is not null;

create or replace view public.first_layer_knowledge_nodes
with (security_invoker = true)
as
select *
from public.public_knowledge_node_declarations
where declared_layer = 'inner';

create or replace view public.second_layer_knowledge_nodes
with (security_invoker = true)
as
select *
from public.public_knowledge_node_declarations
where declared_layer = 'middle';

create or replace view public.third_layer_knowledge_nodes
with (security_invoker = true)
as
select *
from public.public_knowledge_node_declarations
where declared_layer = 'outer';

revoke all on public.public_knowledge_node_declarations,
  public.first_layer_knowledge_nodes,
  public.second_layer_knowledge_nodes,
  public.third_layer_knowledge_nodes
from public, anon, authenticated;
grant select on public.public_knowledge_node_declarations,
  public.first_layer_knowledge_nodes,
  public.second_layer_knowledge_nodes,
  public.third_layer_knowledge_nodes
to authenticated;

-- Server boundary: every newly created node must explicitly name exactly one of
-- the canonical layer codes. Old rows remain untouched, but no future client can
-- rely on type inference or omit classification.
create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  kind text := item#>>'{payload,edit,kind}';
  status text := item#>>'{payload,edit,status}';
  layers jsonb := item#>'{payload,declaredLayers}';
  added_node_ids text[] := '{}';
  added_node_id text;
  layer_key text;
  declared_layer text;
begin
  if jsonb_path_exists(item, '$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode = '22023';
  end if;
  if item->>'type' = 'KnowledgeVerdictFinalized' then
    raise exception 'protocol verdict events are server-only' using errcode = '42501';
  end if;

  if item->>'type' = 'KnowledgeAdded' and kind = 'add' then
    if jsonb_typeof(layers) is distinct from 'object' then
      raise exception 'KnowledgeAdded must declare one canonical layer for every created node' using errcode = '22023';
    end if;

    for added_node_id in
      select node_id from (values
        (item#>>'{payload,edit,node,id}'),
        (item#>>'{payload,edit,reasoning,id}'),
        (item#>>'{payload,edit,conclusion,id}')
      ) as added(node_id)
      where nullif(node_id, '') is not null
    loop
      if added_node_id = any(added_node_ids) then
        raise exception 'KnowledgeAdded contains duplicate created node id: %', added_node_id using errcode = '22023';
      end if;
      added_node_ids := array_append(added_node_ids, added_node_id);
      declared_layer := layers->>added_node_id;
      if declared_layer is null or not exists (
        select 1 from public.knowledge_layer_definitions d where d.layer_code = declared_layer
      ) then
        raise exception 'KnowledgeAdded node % must declare inner, middle, or outer', added_node_id using errcode = '22023';
      end if;
    end loop;

    if cardinality(added_node_ids) = 0 then
      raise exception 'KnowledgeAdded must create at least one node' using errcode = '22023';
    end if;

    -- Reject extra declaration keys so event classification is exact rather than
    -- carrying unrelated or stale node ids.
    for layer_key in select jsonb_object_keys(layers)
    loop
      if not (layer_key = any(added_node_ids)) then
        raise exception 'declaredLayers contains a node not created by this event: %', layer_key using errcode = '22023';
      end if;
    end loop;
    return;
  end if;

  if (item->>'type', kind) in (
    ('KnowledgeNegated', 'negate'),
    ('KnowledgeDecomposed', 'decompose'),
    ('KnowledgeMerged', 'merge')
  ) then
    return;
  end if;

  if item->>'type' = 'KnowledgeStatusChanged'
     and kind = 'status'
     and status in ('verified', 'suspended', 'disputed')
     and nullif(item#>>'{payload,edit,nodeId}', '') is not null
     and (status <> 'suspended' or nullif(item#>>'{payload,edit,causeNodeId}', '') is not null) then
    return;
  end if;

  if item->>'type' = 'KnowledgeNodeEdited'
     and kind = 'update'
     and nullif(item#>>'{payload,edit,nodeId}', '') is not null then
    return;
  end if;

  raise exception 'event type does not match canonical knowledge command' using errcode = '22023';
end $$;

-- Separate feature-gate version: keep knowledge_ball_schema_version() unchanged so
-- unrelated current-main deployments are not broken before this PR is merged.
create or replace function public.knowledge_classification_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608200002'::text $$;

revoke all on function public.knowledge_classification_schema_version() from public, anon;
grant execute on function public.knowledge_classification_schema_version() to authenticated;
