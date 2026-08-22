-- Knowledge Lineage V3 final hardening.
-- Keep the existing V3 state machine; close only authority, identity, and
-- canonicalization gaps that remained after migration 009.

-- One authoritative definition of a permanent account allowed to affect public
-- truth. Supabase anonymous sessions still work for reads/personal state.
create or replace function private.is_eligible_public_voter(target_user_id uuid)
returns boolean
language sql stable security definer
set search_path=public,auth,pg_temp
as $$
  select target_user_id is not null and exists (
    select 1
    from public.knowledge_ball_profiles p
    join auth.users u on u.id=p.user_id
    where p.user_id=target_user_id
      and p.active
      and p.password_login_enabled
      and u.is_anonymous is false
  )
$$;
revoke all on function private.is_eligible_public_voter(uuid)
from public,anon,authenticated;

create or replace function private.eligible_public_voter_count(snapshot_at timestamptz default null)
returns bigint
language sql stable security definer
set search_path=public,auth,pg_temp
as $$
  select greatest(count(*),1)::bigint
  from public.knowledge_ball_profiles p
  join auth.users u on u.id=p.user_id
  where p.active
    and p.password_login_enabled
    and u.is_anonymous is false
    and (snapshot_at is null or p.created_at<=snapshot_at)
$$;
revoke all on function private.eligible_public_voter_count(timestamptz)
from public,anon,authenticated;

comment on function private.is_eligible_public_voter(uuid) is
  'Single server eligibility predicate for public knowledge submission and truth voting.';

-- Public submission consumes the same predicate instead of owning a duplicate
-- definition of “registered user”.
create or replace function public.append_public_knowledge_events(
  expected_head bigint,
  event_batch jsonb
) returns jsonb
language plpgsql security definer
set search_path=public,private,pg_temp
as $$
declare
  current_head bigint;
  item jsonb;
  existing jsonb;
  actor uuid:=auth.uid();
  ids text[]:='{}';
  inserted_at timestamptz;
  added_node_id text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  if not private.is_eligible_public_voter(actor) then
    raise exception '请先注册或登录账户后再提交公共知识' using errcode='42501';
  end if;
  if jsonb_typeof(event_batch)<>'array' or jsonb_array_length(event_batch)>100 then
    raise exception 'invalid event batch' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence),0) into current_head
  from public.public_knowledge_events;
  if current_head<>expected_head then
    raise exception 'remote head conflict' using errcode='KB409',
      detail=jsonb_build_object('current_head',current_head)::text;
  end if;

  for item in select value from jsonb_array_elements(event_batch) loop
    if item->>'scope'<>'public'
       or (item->>'schemaVersion')::integer<>1
       or nullif(item->>'id','') is null
       or jsonb_typeof(item->'payload')<>'object'
       or octet_length(item::text)>65536 then
      raise exception 'invalid public event envelope' using errcode='22023';
    end if;

    perform public.validate_public_knowledge_event(item);
    select envelope into existing
    from public.public_knowledge_events where event_id=item->>'id';
    if existing is not null and existing<>item then
      raise exception 'event id already has a different envelope' using errcode='23505';
    end if;

    inserted_at:=null;
    insert into public.public_knowledge_events(
      event_id,schema_version,event_type,envelope,actor_id
    ) values(item->>'id',1,item->>'type',item,actor)
    on conflict(event_id) do nothing
    returning created_at into inserted_at;

    if inserted_at is not null and item->>'type'='KnowledgeAdded' then
      for added_node_id in
        select node_id from (values
          (item#>>'{payload,edit,node,id}'),
          (item#>>'{payload,edit,reasoning,id}'),
          (item#>>'{payload,edit,conclusion,id}')
        ) as added(node_id)
        where nullif(node_id,'') is not null
      loop
        perform public.fund_new_pending_vote_round(
          added_node_id,actor,inserted_at,item->>'id'
        );
      end loop;
    end if;
    ids:=array_append(ids,item->>'id');
  end loop;

  select coalesce(max(sequence),0) into current_head
  from public.public_knowledge_events;
  return jsonb_build_object(
    'head',current_head,
    'acknowledged_event_ids',to_jsonb(ids)
  );
end $$;
revoke all on function public.append_public_knowledge_events(bigint,jsonb)
from public,anon,authenticated;
grant execute on function public.append_public_knowledge_events(bigint,jsonb)
to authenticated;

-- V1 challenge initiation uses the same permanent-account predicate.
create or replace function private.require_registered_revalidation_initiator()
returns trigger
language plpgsql security definer
set search_path=private,public,auth,pg_temp
as $$
begin
  if auth.uid() is null or new.initiator_id is distinct from auth.uid() then
    raise exception 'revalidation initiator must match authenticated user' using errcode='42501';
  end if;
  if not private.is_eligible_public_voter(new.initiator_id) then
    raise exception '请先注册或登录账户后再发起重新验证' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.require_registered_revalidation_initiator()
from public,anon,authenticated;

-- Override stale profile counts computed inside legacy RPC bodies at the table
-- boundary. This covers INITIAL, automatic CASCADE, and human V1 rounds without
-- duplicating eligibility conditions in each RPC.
create or replace function private.enforce_pending_vote_round_contract()
returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
begin
  new.eligible_user_snapshot:=private.eligible_public_voter_count(new.opened_at);
  new.required_votes:=public.pending_vote_required_for_snapshot(new.eligible_user_snapshot);
  if new.round_kind='CASCADE' then
    new.policy_version:='KNOWLEDGE_LINEAGE_V3_CASCADE';
  end if;
  return new;
end $$;
revoke all on function private.enforce_pending_vote_round_contract()
from public,anon,authenticated;

drop trigger if exists a0_enforce_pending_vote_round_contract
on public.knowledge_pending_vote_rounds;
create trigger a0_enforce_pending_vote_round_contract
before insert on public.knowledge_pending_vote_rounds
for each row execute function private.enforce_pending_vote_round_contract();

create or replace function private.enforce_revalidation_round_eligibility()
returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
begin
  new.eligible_user_snapshot:=private.eligible_public_voter_count(new.opened_at);
  new.required_votes:=public.pending_vote_required_for_snapshot(new.eligible_user_snapshot);
  return new;
end $$;
revoke all on function private.enforce_revalidation_round_eligibility()
from public,anon,authenticated;

drop trigger if exists a0_enforce_revalidation_round_eligibility
on private.knowledge_revalidation_rounds;
create trigger a0_enforce_revalidation_round_eligibility
before insert on private.knowledge_revalidation_rounds
for each row execute function private.enforce_revalidation_round_eligibility();

-- Ballot tables are the final defense against unofficial clients. Any work the old
-- RPC performs before INSERT is in the same transaction and is rolled back when
-- this trigger rejects an ineligible/anonymous voter.
create or replace function private.require_eligible_pending_voter()
returns trigger
language plpgsql security definer
set search_path=private,public,auth,pg_temp
as $$
begin
  if not private.is_eligible_public_voter(new.voter_id) then
    raise exception '请先注册或登录账户后再参与公共知识投票' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.require_eligible_pending_voter()
from public,anon,authenticated;

drop trigger if exists require_eligible_pending_voter
on public.knowledge_pending_votes;
create trigger require_eligible_pending_voter
before insert on public.knowledge_pending_votes
for each row execute function private.require_eligible_pending_voter();

create or replace function private.require_eligible_revalidation_voter()
returns trigger
language plpgsql security definer
set search_path=private,public,auth,pg_temp
as $$
begin
  if not private.is_eligible_public_voter(new.voter_id) then
    raise exception '请先注册或登录账户后再参与公共知识投票' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.require_eligible_revalidation_voter()
from public,anon,authenticated;

drop trigger if exists require_eligible_revalidation_voter
on private.knowledge_revalidation_votes;
create trigger require_eligible_revalidation_voter
before insert on private.knowledge_revalidation_votes
for each row execute function private.require_eligible_revalidation_voter();

-- CASCADE is a Lineage V3 one-energy support recheck, not human
-- ORIGINAL_DESIGN_V1. Relabel historical cascade rows and constrain future rows.
alter table public.knowledge_pending_vote_rounds
  drop constraint if exists knowledge_pending_vote_rounds_policy_version_check;
update public.knowledge_pending_vote_rounds
set policy_version='KNOWLEDGE_LINEAGE_V3_CASCADE'
where round_kind='CASCADE';
alter table public.knowledge_pending_vote_rounds
  add constraint knowledge_pending_vote_rounds_policy_version_check
  check (policy_version in (
    'ORIGINAL_DESIGN_V1',
    'ORIGINAL_DESIGN_V2',
    'KNOWLEDGE_LINEAGE_V3_CASCADE'
  ));

-- Match the browser canonical title contract: NFKC -> trim -> collapse whitespace
-- -> lowercase. PostgreSQL normalize() is built in and the hosted DB is UTF-8.
create or replace function private.canonical_knowledge_title(value text)
returns text
language sql immutable strict
set search_path=pg_catalog
as $$
  select lower(regexp_replace(trim(normalize(value,NFKC)),'[[:space:]]+',' ','g'))
$$;
revoke all on function private.canonical_knowledge_title(text)
from public,anon,authenticated;

-- Read the immutable structural identity of a node from its birth event.
create or replace function private.knowledge_node_logic_rule(target_node_id text)
returns text
language sql stable security definer
set search_path=public,pg_temp
as $$
  select case
    when e.envelope#>>'{payload,edit,node,id}'=target_node_id
      then e.envelope#>>'{payload,edit,node,logicRuleId}'
    when e.envelope#>>'{payload,edit,reasoning,id}'=target_node_id
      then e.envelope#>>'{payload,edit,reasoning,logicRuleId}'
    when e.envelope#>>'{payload,edit,conclusion,id}'=target_node_id
      then e.envelope#>>'{payload,edit,conclusion,logicRuleId}'
    else null
  end
  from public.public_knowledge_events e
  where e.event_type='KnowledgeAdded'
    and (
      e.envelope#>>'{payload,edit,node,id}'=target_node_id
      or e.envelope#>>'{payload,edit,reasoning,id}'=target_node_id
      or e.envelope#>>'{payload,edit,conclusion,id}'=target_node_id
    )
  order by e.sequence
  limit 1
$$;
revoke all on function private.knowledge_node_logic_rule(text)
from public,anon,authenticated;

-- Ordinary clients may submit immutable content proposals, but protocol lifecycle
-- events and public status transitions are server-owned. Lineage candidates also
-- inherit type + logic-rule identity at this boundary, not merely in the browser.
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

  if (item->>'type',kind) in (
    ('KnowledgeDecomposed','decompose'),
    ('KnowledgeMerged','merge')
  ) then
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
as $$ select '202608220010'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
