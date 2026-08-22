-- Knowledge Lineage V3 / module 4.
--
-- 1. Harden modules 1-3 by projecting lineage roles on the server from the
--    append-only public event stream. Clients never choose current/history/
--    opposition truth.
-- 2. Add second/subsequent verification as a separate ORIGINAL_DESIGN_V1
--    challenge system. The existing INITIAL V2 tables/functions are untouched.
-- 3. Keep raw lineage/challenge tables outside the exposed Data API schema.
--
-- The frozen TypeScript interpreter remains the product source of truth:
-- src/domain/truth-protocol/v1/original-design-policy.ts
-- The SQL policy function below is the server executor of the same stage formula;
-- repository tests and hosted verification compare representative stages.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Authoritative lineage projection for modules 1-3
-- ---------------------------------------------------------------------------

create table private.knowledge_lineage_members (
  node_id text primary key,
  topic_id text not null,
  proposal text not null check (proposal in ('new','optimization','opposition')),
  target_id text,
  role text not null check (role in (
    'current','history','opposition','candidate-history','candidate-opposition','rejected'
  )),
  rank integer not null default 0 check (rank >= 0),
  revalidating boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((role in ('current','candidate-history','candidate-opposition','rejected') and rank = 0)
      or (role in ('history','opposition') and rank > 0)),
  check ((proposal in ('optimization','opposition') and target_id is not null)
      or proposal = 'new')
);
create unique index knowledge_lineage_one_current_per_topic
  on private.knowledge_lineage_members(topic_id) where role='current';
create unique index knowledge_lineage_history_rank
  on private.knowledge_lineage_members(topic_id,rank) where role='history';
create unique index knowledge_lineage_opposition_rank
  on private.knowledge_lineage_members(topic_id,rank) where role='opposition';
create unique index knowledge_lineage_one_pending_head_change
  on private.knowledge_lineage_members(topic_id)
  where role in ('candidate-history','candidate-opposition');
create index knowledge_lineage_topic_role
  on private.knowledge_lineage_members(topic_id,role,rank);
alter table private.knowledge_lineage_members enable row level security;
revoke all on private.knowledge_lineage_members from public, anon, authenticated;

-- Existing hosted data predates explicit lineage metadata. Every already-final
-- CORRECT node is therefore the current head of its own one-ball topic.
with latest as (
  select distinct on (node_id) node_id, verdict
  from public.knowledge_pending_vote_rounds
  where verdict in ('CORRECT','INCORRECT')
  order by node_id, round_no desc, closed_at desc nulls last, id desc
)
insert into private.knowledge_lineage_members(node_id,topic_id,proposal,role,rank)
select node_id,node_id,'new','current',0
from latest where verdict='CORRECT'
on conflict(node_id) do nothing;

create or replace function private.lineage_promote_optimization(candidate_id text) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare c private.knowledge_lineage_members%rowtype; current_id text;
begin
  select * into c from private.knowledge_lineage_members where node_id=candidate_id for update;
  if not found or c.role<>'candidate-history' or c.proposal<>'optimization' then
    raise exception 'invalid optimization lineage candidate' using errcode='22023';
  end if;
  select node_id into current_id from private.knowledge_lineage_members
    where topic_id=c.topic_id and role='current' for update;
  if current_id is null or current_id<>c.target_id then
    raise exception 'stale optimization lineage target' using errcode='KB409';
  end if;

  update private.knowledge_lineage_members
  set rank=rank+1000000,updated_at=now()
  where topic_id=c.topic_id and role='history';
  update private.knowledge_lineage_members
  set role='history',rank=1,updated_at=now()
  where node_id=current_id;
  update private.knowledge_lineage_members
  set rank=rank-999999,updated_at=now()
  where topic_id=c.topic_id and role='history' and rank>=1000000;
  update private.knowledge_lineage_members
  set role='current',rank=0,revalidating=false,updated_at=now()
  where node_id=candidate_id;
end $$;

create or replace function private.lineage_promote_opposition(candidate_id text) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare c private.knowledge_lineage_members%rowtype; current_id text;
begin
  select * into c from private.knowledge_lineage_members where node_id=candidate_id for update;
  if not found or c.role<>'candidate-opposition' or c.proposal<>'opposition' then
    raise exception 'invalid opposition lineage candidate' using errcode='22023';
  end if;
  select node_id into current_id from private.knowledge_lineage_members
    where topic_id=c.topic_id and role='current' for update;
  if current_id is null or current_id<>c.target_id then
    raise exception 'stale opposition lineage target' using errcode='KB409';
  end if;

  update private.knowledge_lineage_members
  set rank=rank+1000000,updated_at=now()
  where topic_id=c.topic_id and role='history';
  update private.knowledge_lineage_members
  set rank=rank+2000000,updated_at=now()
  where topic_id=c.topic_id and role='opposition';

  -- The old red side becomes gray history of the winning viewpoint.
  update private.knowledge_lineage_members
  set role='history',rank=rank-2000000,updated_at=now()
  where topic_id=c.topic_id and role='opposition' and rank>=2000000;

  -- The old current side becomes the red opposition lineage.
  update private.knowledge_lineage_members
  set role='opposition',rank=1,updated_at=now()
  where node_id=current_id;
  update private.knowledge_lineage_members
  set role='opposition',rank=rank-999999,updated_at=now()
  where topic_id=c.topic_id and role='history' and rank>=1000000;

  update private.knowledge_lineage_members
  set role='current',rank=0,revalidating=false,updated_at=now()
  where node_id=candidate_id;
end $$;

create or replace function private.lineage_reactivate_history(selected_id text) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare s private.knowledge_lineage_members%rowtype; current_id text;
begin
  select * into s from private.knowledge_lineage_members where node_id=selected_id for update;
  if not found or s.role<>'history' or not s.revalidating then
    raise exception 'history node is not in active revalidation' using errcode='22023';
  end if;
  select node_id into current_id from private.knowledge_lineage_members
    where topic_id=s.topic_id and role='current' for update;
  if current_id is null then raise exception 'lineage current missing'; end if;

  -- Move every old gray rank out of the way before inserting the former current.
  update private.knowledge_lineage_members
  set rank=rank+1000000,updated_at=now()
  where topic_id=s.topic_id and role='history';
  update private.knowledge_lineage_members
  set role='history',rank=1,updated_at=now()
  where node_id=current_id;

  with ordered as (
    select node_id,row_number() over(order by rank,node_id)::integer+1 as new_rank
    from private.knowledge_lineage_members
    where topic_id=s.topic_id and role='history' and rank>=1000000 and node_id<>selected_id
  )
  update private.knowledge_lineage_members m
  set rank=o.new_rank,updated_at=now()
  from ordered o where m.node_id=o.node_id;

  update private.knowledge_lineage_members
  set role='current',rank=0,revalidating=false,updated_at=now()
  where node_id=selected_id;
end $$;

create or replace function private.lineage_reactivate_opposition(selected_id text) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare s private.knowledge_lineage_members%rowtype; current_id text;
begin
  select * into s from private.knowledge_lineage_members where node_id=selected_id for update;
  if not found or s.role<>'opposition' or not s.revalidating then
    raise exception 'opposition node is not in active revalidation' using errcode='22023';
  end if;
  select node_id into current_id from private.knowledge_lineage_members
    where topic_id=s.topic_id and role='current' for update;
  if current_id is null then raise exception 'lineage current missing'; end if;

  update private.knowledge_lineage_members
  set rank=rank+1000000,updated_at=now()
  where topic_id=s.topic_id and role='history';
  update private.knowledge_lineage_members
  set rank=rank+2000000,updated_at=now()
  where topic_id=s.topic_id and role='opposition';

  -- Other red versions become the winning side's gray history, preserving order.
  with ordered as (
    select node_id,row_number() over(order by rank,node_id)::integer as new_rank
    from private.knowledge_lineage_members
    where topic_id=s.topic_id and role='opposition' and rank>=2000000 and node_id<>selected_id
  )
  update private.knowledge_lineage_members m
  set role='history',rank=o.new_rank,updated_at=now()
  from ordered o where m.node_id=o.node_id;

  update private.knowledge_lineage_members
  set role='opposition',rank=1,updated_at=now()
  where node_id=current_id;
  with ordered as (
    select node_id,row_number() over(order by rank,node_id)::integer+1 as new_rank
    from private.knowledge_lineage_members
    where topic_id=s.topic_id and role='history' and rank>=1000000
  )
  update private.knowledge_lineage_members m
  set role='opposition',rank=o.new_rank,updated_at=now()
  from ordered o where m.node_id=o.node_id;

  update private.knowledge_lineage_members
  set role='current',rank=0,revalidating=false,updated_at=now()
  where node_id=selected_id;
end $$;

create or replace function private.project_knowledge_lineage_event() returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  candidate_id text;
  target_id text;
  topic_id text;
  verdict text;
  candidate_role text;
  start_role text;
begin
  if new.event_type='KnowledgeAdded' then
    if new.envelope#>'{payload,optimization}' is not null then
      candidate_id:=new.envelope#>>'{payload,edit,node,id}';
      target_id:=new.envelope#>>'{payload,optimization,targetId}';
      topic_id:=new.envelope#>>'{payload,optimization,topicId}';
      insert into private.knowledge_lineage_members(node_id,topic_id,proposal,target_id,role,rank)
      values(candidate_id,topic_id,'optimization',target_id,'candidate-history',0);
    elsif new.envelope#>'{payload,opposition}' is not null then
      candidate_id:=new.envelope#>>'{payload,edit,node,id}';
      target_id:=new.envelope#>>'{payload,opposition,targetId}';
      topic_id:=new.envelope#>>'{payload,opposition,topicId}';
      insert into private.knowledge_lineage_members(node_id,topic_id,proposal,target_id,role,rank)
      values(candidate_id,topic_id,'opposition',target_id,'candidate-opposition',0);
    end if;
    return new;
  end if;

  if new.event_type='KnowledgeVerdictFinalized' then
    candidate_id:=new.envelope#>>'{payload,nodeId}';
    verdict:=new.envelope#>>'{payload,verdict}';
    select role into candidate_role from private.knowledge_lineage_members where node_id=candidate_id;
    if candidate_role='candidate-history' then
      if verdict='CORRECT' then perform private.lineage_promote_optimization(candidate_id);
      else update private.knowledge_lineage_members set role='rejected',rank=0,revalidating=false,updated_at=now() where node_id=candidate_id;
      end if;
    elsif candidate_role='candidate-opposition' then
      if verdict='CORRECT' then perform private.lineage_promote_opposition(candidate_id);
      else update private.knowledge_lineage_members set role='rejected',rank=0,revalidating=false,updated_at=now() where node_id=candidate_id;
      end if;
    elsif verdict='CORRECT' and not exists(select 1 from private.knowledge_lineage_members where node_id=candidate_id) then
      insert into private.knowledge_lineage_members(node_id,topic_id,proposal,role,rank)
      values(candidate_id,candidate_id,'new','current',0)
      on conflict(node_id) do nothing;
    end if;
    return new;
  end if;

  if new.event_type='KnowledgeRevalidationStarted' then
    candidate_id:=new.envelope#>>'{payload,nodeId}';
    start_role:=new.envelope#>>'{payload,roleAtStart}';
    update private.knowledge_lineage_members
    set revalidating=true,updated_at=now()
    where node_id=candidate_id and role=start_role and role in ('history','opposition') and not revalidating;
    if not found then raise exception 'server revalidation start does not match stable lineage state' using errcode='KB409'; end if;
    return new;
  end if;

  if new.event_type='KnowledgeRevalidationFinalized' then
    candidate_id:=new.envelope#>>'{payload,nodeId}';
    verdict:=new.envelope#>>'{payload,verdict}';
    if verdict='INCORRECT' then
      update private.knowledge_lineage_members
      set revalidating=false,updated_at=now()
      where node_id=candidate_id and revalidating and role in ('history','opposition');
      if not found then raise exception 'server revalidation finalize has no active target' using errcode='KB409'; end if;
    else
      select role into start_role from private.knowledge_lineage_members where node_id=candidate_id and revalidating;
      if start_role='history' then perform private.lineage_reactivate_history(candidate_id);
      elsif start_role='opposition' then perform private.lineage_reactivate_opposition(candidate_id);
      else raise exception 'server revalidation finalize has invalid lineage role' using errcode='KB409';
      end if;
    end if;
    return new;
  end if;

  return new;
end $$;

revoke all on function private.lineage_promote_optimization(text),
  private.lineage_promote_opposition(text),
  private.lineage_reactivate_history(text),
  private.lineage_reactivate_opposition(text),
  private.project_knowledge_lineage_event()
from public, anon, authenticated;

drop trigger if exists project_knowledge_lineage_event on public.public_knowledge_events;
create trigger project_knowledge_lineage_event
after insert on public.public_knowledge_events
for each row execute function private.project_knowledge_lineage_event();

-- ---------------------------------------------------------------------------
-- Harden client KnowledgeAdded lineage intent. Server-authored lifecycle events
-- can never be submitted through append_public_knowledge_events.
-- ---------------------------------------------------------------------------

create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql
stable
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
  target_row private.knowledge_lineage_members%rowtype;
  has_optimization boolean := item#>'{payload,optimization}' is not null;
  has_opposition boolean := item#>'{payload,opposition}' is not null;
begin
  if jsonb_path_exists(item, '$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode='22023';
  end if;
  if item->>'type' in ('KnowledgeVerdictFinalized','KnowledgeRevalidationStarted','KnowledgeRevalidationFinalized') then
    raise exception 'protocol lifecycle events are server-only' using errcode='42501';
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
      if added_node_id=any(added_node_ids) then raise exception 'KnowledgeAdded contains duplicate created node id: %',added_node_id using errcode='22023'; end if;
      added_node_ids:=array_append(added_node_ids,added_node_id);
      declared_layer:=layers->>added_node_id;
      if declared_layer is null or not exists(select 1 from public.knowledge_layer_definitions d where d.layer_code=declared_layer) then
        raise exception 'KnowledgeAdded node % must declare inner, middle, or outer',added_node_id using errcode='22023';
      end if;
    end loop;
    if cardinality(added_node_ids)=0 then raise exception 'KnowledgeAdded must create at least one node' using errcode='22023'; end if;
    for layer_key in select jsonb_object_keys(layers) loop
      if not(layer_key=any(added_node_ids)) then raise exception 'declaredLayers contains a node not created by this event: %',layer_key using errcode='22023'; end if;
    end loop;

    if has_optimization and has_opposition then
      raise exception 'KnowledgeAdded cannot be optimization and opposition simultaneously' using errcode='22023';
    end if;
    if has_optimization or has_opposition then
      if item#>>'{payload,edit,mode}'<>'atomic' or cardinality(added_node_ids)<>1 then
        raise exception 'lineage head-change candidate must be one atomic immutable node' using errcode='22023';
      end if;
      target_id:=case when has_optimization then item#>>'{payload,optimization,targetId}' else item#>>'{payload,opposition,targetId}' end;
      topic_id:=case when has_optimization then item#>>'{payload,optimization,topicId}' else item#>>'{payload,opposition,topicId}' end;
      if nullif(target_id,'') is null or nullif(topic_id,'') is null then raise exception 'lineage candidate requires targetId and topicId' using errcode='22023'; end if;
      select * into target_row from private.knowledge_lineage_members where node_id=target_id;
      if not found or target_row.role<>'current' or target_row.topic_id<>topic_id or target_row.revalidating then
        raise exception 'lineage candidate target is not the stable current head' using errcode='KB409';
      end if;
      if exists(select 1 from private.knowledge_lineage_members where topic_id=topic_id and role in ('candidate-history','candidate-opposition')) then
        raise exception 'knowledge topic already has a pending head-change candidate' using errcode='KB409';
      end if;
    end if;
    return;
  end if;

  if (item->>'type',kind) in (
    ('KnowledgeNegated','negate'),('KnowledgeDecomposed','decompose'),('KnowledgeMerged','merge')
  ) then return; end if;
  if item->>'type'='KnowledgeStatusChanged' and kind='status'
     and status in ('verified','suspended','disputed')
     and nullif(item#>>'{payload,edit,nodeId}','') is not null
     and (status<>'suspended' or nullif(item#>>'{payload,edit,causeNodeId}','') is not null) then return; end if;
  if item->>'type'='KnowledgeNodeEdited' and kind='update'
     and nullif(item#>>'{payload,edit,nodeId}','') is not null then return; end if;
  raise exception 'event type does not match canonical knowledge command' using errcode='22023';
end $$;
revoke all on function public.validate_public_knowledge_event(jsonb) from public, anon, authenticated;

-- Server event type whitelist.
alter table public.public_knowledge_events drop constraint if exists public_knowledge_events_event_type_check;
alter table public.public_knowledge_events add constraint public_knowledge_events_event_type_check
  check(event_type in (
    'NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved',
    'KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged',
    'KnowledgeNodeEdited','KnowledgeVerdictFinalized','KnowledgeRevalidationStarted','KnowledgeRevalidationFinalized'
  ));

-- ---------------------------------------------------------------------------
-- Frozen ORIGINAL_DESIGN_V1 second/subsequent challenge rounds
-- ---------------------------------------------------------------------------

alter table public.energy_transactions drop constraint if exists energy_transactions_transaction_type_check;
alter table public.energy_transactions add constraint energy_transactions_transaction_type_check
  check(transaction_type in (
    'REFERRAL','SPEND','TRANSFER','VOTE_STAKE','CLAIM_STAKE','VOTE_SETTLEMENT',
    'CHALLENGE_STAKE','CHALLENGE_VOTE_STAKE','CHALLENGE_SETTLEMENT'
  ));

create table private.knowledge_revalidation_progress (
  topic_id text primary key,
  next_stage integer not null default 0 check(next_stage>=0),
  updated_at timestamptz not null default now()
);
alter table private.knowledge_revalidation_progress enable row level security;
revoke all on private.knowledge_revalidation_progress from public, anon, authenticated;

create table private.knowledge_revalidation_rounds (
  id uuid primary key default gen_random_uuid(),
  topic_id text not null,
  node_id text not null references private.knowledge_lineage_members(node_id),
  round_no integer not null check(round_no>0),
  policy_version text not null default 'ORIGINAL_DESIGN_V1' check(policy_version='ORIGINAL_DESIGN_V1'),
  role_at_start text not null check(role_at_start in ('history','opposition')),
  stage integer not null check(stage>=0),
  scope text not null check(scope in ('GLOBAL','LOCAL_10')),
  accuracy_gate integer check(accuracy_gate is null or accuracy_gate between 0 and 100),
  local_hop_limit integer check(local_hop_limit is null or local_hop_limit=10),
  stake numeric(30,6) not null check(stake>0 and scale(stake)<=6),
  initiator_id uuid not null references auth.users(id),
  eligible_user_snapshot bigint not null check(eligible_user_snapshot>=0),
  required_votes integer not null check(required_votes>0),
  opened_at timestamptz not null,
  deadline timestamptz not null,
  verdict text not null default 'PENDING' check(verdict in ('PENDING','CORRECT','INCORRECT')),
  close_reason text check(close_reason is null or close_reason in ('THRESHOLD','TIMEOUT')),
  closed_at timestamptz,
  final_agree_count integer check(final_agree_count is null or final_agree_count>=0),
  final_disagree_count integer check(final_disagree_count is null or final_disagree_count>=0),
  initiator_stake_transaction_id uuid not null unique references public.energy_transactions(id),
  settlement_transaction_id uuid unique references public.energy_transactions(id),
  unique(topic_id,round_no),
  check(deadline=opened_at+interval '720 hours'),
  check((verdict='PENDING' and closed_at is null and close_reason is null)
     or (verdict<>'PENDING' and closed_at is not null and close_reason is not null))
);
create unique index knowledge_revalidation_one_open_topic
  on private.knowledge_revalidation_rounds(topic_id) where verdict='PENDING';
create index knowledge_revalidation_deadline
  on private.knowledge_revalidation_rounds(deadline) where verdict='PENDING';
alter table private.knowledge_revalidation_rounds enable row level security;
revoke all on private.knowledge_revalidation_rounds from public, anon, authenticated;

create table private.knowledge_revalidation_votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references private.knowledge_revalidation_rounds(id),
  voter_id uuid not null references auth.users(id),
  side text not null check(side in ('AGREE','DISAGREE')),
  stake numeric(30,6) not null check(stake>0 and scale(stake)<=6),
  transaction_id uuid not null unique references public.energy_transactions(id),
  created_at timestamptz not null default now(),
  unique(round_id,voter_id)
);
create index knowledge_revalidation_votes_round_side
  on private.knowledge_revalidation_votes(round_id,side,created_at,id);
alter table private.knowledge_revalidation_votes enable row level security;
revoke all on private.knowledge_revalidation_votes from public, anon, authenticated;

create or replace function private.knowledge_revalidation_policy(challenge_stage integer)
returns table(stake numeric,scope text,accuracy_gate integer,local_hop_limit integer)
language plpgsql
immutable strict
set search_path = private, pg_temp
as $$
declare
  gated_index integer;
  cycle_length constant integer:=30;
  tier_index integer;
  within_tier integer;
  gates constant integer[]:=array[50,60,70,80,90,91,92,93,94,95,96,97,98,99,100];
begin
  if challenge_stage<0 then raise exception 'stage must be non-negative' using errcode='22023'; end if;
  if challenge_stage=0 then return query select 10.000000::numeric,'GLOBAL'::text,null::integer,null::integer; return; end if;
  if challenge_stage=1 then return query select 10.000000::numeric,'LOCAL_10'::text,null::integer,10::integer; return; end if;
  gated_index:=challenge_stage-2;
  tier_index:=gated_index/cycle_length;
  within_tier:=mod(gated_index,cycle_length);
  stake:=((mod(tier_index,9)+1)::numeric*power(10::numeric,(tier_index/9)+1))::numeric(30,6);
  scope:=case when mod(within_tier,2)=0 then 'GLOBAL' else 'LOCAL_10' end;
  accuracy_gate:=gates[(within_tier/2)+1];
  local_hop_limit:=case when scope='LOCAL_10' then 10 else null end;
  return next;
end $$;
revoke all on function private.knowledge_revalidation_policy(integer) from public, anon, authenticated;

create or replace function private.knowledge_revalidation_snapshot(target_node_id text) returns jsonb
language plpgsql
security definer
stable
set search_path = private, public, pg_temp
as $$
declare
  actor uuid:=auth.uid();
  r private.knowledge_revalidation_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  my_side text;
  my_balance numeric(30,6);
begin
  select * into r from private.knowledge_revalidation_rounds
  where node_id=target_node_id order by round_no desc limit 1;
  if not found then raise exception 'revalidation round not found' using errcode='22023'; end if;
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count from private.knowledge_revalidation_votes where round_id=r.id;
  select side into my_side from private.knowledge_revalidation_votes where round_id=r.id and voter_id=actor;
  if actor is not null then select balance into my_balance from public.energy_accounts where user_id=actor; end if;
  return jsonb_build_object(
    'node_id',r.node_id,'topic_id',r.topic_id,'round_id',r.id::text,'round_no',r.round_no,
    'stage',r.stage,'stake',r.stake::text,'scope',r.scope,'accuracy_gate',r.accuracy_gate,
    'local_hop_limit',r.local_hop_limit,'role_at_start',r.role_at_start,
    'agree_count',agree_count,'disagree_count',disagree_count,'required_votes',r.required_votes,
    'my_side',my_side,'my_balance',case when my_balance is null then null else my_balance::text end,
    'verdict',r.verdict,'close_reason',r.close_reason,'deadline',r.deadline,'closed_at',r.closed_at,
    'policy_version',r.policy_version
  );
end $$;
revoke all on function private.knowledge_revalidation_snapshot(text) from public, anon, authenticated;

create or replace function private.emit_revalidation_started(r private.knowledge_revalidation_rounds) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare e jsonb;
begin
  e:=jsonb_build_object(
    'id','revalidation-start:'||r.id::text,
    'type','KnowledgeRevalidationStarted','scope','public','schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_strip_nulls(jsonb_build_object(
      'roundId',r.id::text,'nodeId',r.node_id,'topicId',r.topic_id,'roleAtStart',r.role_at_start,
      'stage',r.stage,'stake',r.stake::text,'scope',r.scope,'accuracyGate',r.accuracy_gate,
      'localHopLimit',r.local_hop_limit,'requiredVotes',r.required_votes,'deadline',r.deadline,
      'policyVersion','ORIGINAL_DESIGN_V1'
    ))
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(e->>'id',1,'KnowledgeRevalidationStarted',e,r.initiator_id)
  on conflict(event_id) do nothing;
end $$;

create or replace function private.emit_revalidation_finalized(r private.knowledge_revalidation_rounds) returns void
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare e jsonb;
begin
  e:=jsonb_build_object(
    'id','revalidation-final:'||r.id::text,
    'type','KnowledgeRevalidationFinalized','scope','public','schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object(
      'roundId',r.id::text,'nodeId',r.node_id,'topicId',r.topic_id,'verdict',r.verdict,
      'closeReason',r.close_reason,'agreeCount',r.final_agree_count,'disagreeCount',r.final_disagree_count,
      'requiredVotes',r.required_votes,'stage',r.stage,'policyVersion','ORIGINAL_DESIGN_V1'
    )
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(e->>'id',1,'KnowledgeRevalidationFinalized',e,r.initiator_id)
  on conflict(event_id) do nothing;
end $$;
revoke all on function private.emit_revalidation_started(private.knowledge_revalidation_rounds),
  private.emit_revalidation_finalized(private.knowledge_revalidation_rounds)
from public, anon, authenticated;

create or replace function private.finalize_knowledge_revalidation(target_round_id uuid) returns jsonb
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  r private.knowledge_revalidation_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  decided text;
  reason text;
  winner_side text;
  winner_count bigint;
  loser_count bigint;
  stake_atoms bigint;
  losing_atoms bigint;
  share_atoms bigint:=0;
  remainder_atoms bigint:=0;
  idx bigint:=0;
  position record;
  payout_atoms bigint;
  payout numeric(30,6);
  total_payout numeric(30,6):=0.000000;
  system_account constant uuid:='00000000-0000-0000-0000-000000000001';
  tx uuid;
  request_hash text;
begin
  select * into r from private.knowledge_revalidation_rounds where id=target_round_id for update;
  if not found then raise exception 'revalidation round not found' using errcode='22023'; end if;
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count from private.knowledge_revalidation_votes where round_id=r.id;
  if r.verdict<>'PENDING' then return private.knowledge_revalidation_snapshot(r.node_id); end if;

  if agree_count>=r.required_votes then decided:='CORRECT'; reason:='THRESHOLD';
  elsif disagree_count>=r.required_votes then decided:='INCORRECT'; reason:='THRESHOLD';
  elsif now()>=r.deadline then
    -- Frozen V1: initiator is AGREE and participates only in timeout majority.
    if agree_count+1=disagree_count then return private.knowledge_revalidation_snapshot(r.node_id); end if;
    decided:=case when agree_count+1>disagree_count then 'CORRECT' else 'INCORRECT' end;
    reason:='TIMEOUT';
  else return private.knowledge_revalidation_snapshot(r.node_id);
  end if;

  winner_side:=case when decided='CORRECT' then 'AGREE' else 'DISAGREE' end;
  winner_count:=(case when winner_side='AGREE' then 1 else 0 end)
    + case when winner_side='AGREE' then agree_count else disagree_count end;
  loser_count:=(case when winner_side='DISAGREE' then 1 else 0 end)
    + case when winner_side='AGREE' then disagree_count else agree_count end;
  stake_atoms:=(r.stake*1000000)::bigint;
  losing_atoms:=loser_count*stake_atoms;
  if winner_count>0 then share_atoms:=losing_atoms/winner_count; remainder_atoms:=losing_atoms%winner_count; end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'round_id',r.id,'verdict',decided,'agree_count',agree_count,'disagree_count',disagree_count,
    'required_votes',r.required_votes,'stage',r.stage,'stake',r.stake::text
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('CHALLENGE_SETTLEMENT','challenge-settlement:'||r.id::text,
    jsonb_build_object('operation','KNOWLEDGE_REVALIDATION_SETTLEMENT','round_id',r.id,'node_id',r.node_id,
      'topic_id',r.topic_id,'verdict',decided,'stage',r.stage,'stake',r.stake::text),
    r.initiator_id,request_hash)
  returning id into tx;

  for position in
    select position_key,account_id from (
      select 'initiator:'||r.initiator_id::text as position_key,a.id as account_id
      from public.energy_accounts a where winner_side='AGREE' and a.user_id=r.initiator_id
      union all
      select 'vote:'||v.id::text,a.id
      from private.knowledge_revalidation_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=r.id and v.side=winner_side
    ) winners order by position_key
  loop
    payout_atoms:=stake_atoms+share_atoms+case when idx<remainder_atoms then 1 else 0 end;
    payout:=(payout_atoms::numeric/1000000)::numeric(30,6);
    insert into public.energy_ledger_entries(transaction_id,account_id,amount) values(tx,position.account_id,payout);
    update public.energy_accounts set balance=balance+payout where id=position.account_id;
    total_payout:=total_payout+payout;
    idx:=idx+1;
  end loop;
  if total_payout<>0 then
    insert into public.energy_ledger_entries(transaction_id,account_id,amount) values(tx,system_account,-total_payout);
    update public.energy_accounts set balance=balance-total_payout where id=system_account;
  end if;

  update private.knowledge_revalidation_rounds
  set verdict=decided,close_reason=reason,closed_at=now(),final_agree_count=agree_count,
      final_disagree_count=disagree_count,settlement_transaction_id=tx
  where id=r.id returning * into r;

  insert into private.knowledge_revalidation_progress(topic_id,next_stage)
  values(r.topic_id,case when decided='CORRECT' then 0 else r.stage+1 end)
  on conflict(topic_id) do update set next_stage=excluded.next_stage,updated_at=now();

  perform private.emit_revalidation_finalized(r);
  perform public.assert_energy_conservation();
  return private.knowledge_revalidation_snapshot(r.node_id);
end $$;
revoke all on function private.finalize_knowledge_revalidation(uuid) from public, anon, authenticated;

create or replace function public.start_knowledge_revalidation(target_node_id text,operation_key text) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor uuid:=auth.uid();
  member private.knowledge_lineage_members%rowtype;
  existing_round private.knowledge_revalidation_rounds%rowtype;
  policy record;
  stage integer;
  next_round integer;
  snapshot bigint;
  required integer;
  accuracy numeric;
  account_id uuid;
  tx uuid;
  request_hash text;
  existing_hash text;
  opened timestamptz:=clock_timestamp();
  r private.knowledge_revalidation_rounds%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if nullif(trim(target_node_id),'') is null or nullif(trim(operation_key),'') is null then raise exception 'node id and idempotency key required' using errcode='22023'; end if;
  perform public.ensure_anonymous_profile();

  select * into member from private.knowledge_lineage_members where node_id=target_node_id;
  if not found or member.role not in ('history','opposition') then raise exception 'only stable history/opposition knowledge can be revalidated' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('knowledge-revalidation:'||member.topic_id,0));
  select * into member from private.knowledge_lineage_members where node_id=target_node_id for update;
  if member.role not in ('history','opposition') or member.revalidating then
    select * into existing_round from private.knowledge_revalidation_rounds where node_id=target_node_id and verdict='PENDING' order by round_no desc limit 1;
    if found then return private.knowledge_revalidation_snapshot(target_node_id); end if;
    raise exception 'knowledge node is not a stable revalidation target' using errcode='KB409';
  end if;
  if exists(select 1 from private.knowledge_lineage_members where topic_id=member.topic_id and role in ('candidate-history','candidate-opposition')) then
    raise exception 'topic already has a pending head-change candidate' using errcode='KB409';
  end if;
  if exists(select 1 from private.knowledge_revalidation_rounds where topic_id=member.topic_id and verdict='PENDING') then
    raise exception 'topic already has an active revalidation round' using errcode='KB409';
  end if;

  select coalesce(p.next_stage,0) into stage from private.knowledge_revalidation_progress p where p.topic_id=member.topic_id;
  if stage is null then stage:=0; end if;
  select * into policy from private.knowledge_revalidation_policy(stage);
  accuracy:=coalesce((public.get_my_account()->>'accuracy')::numeric,0);
  if policy.accuracy_gate is not null and accuracy<policy.accuracy_gate then
    raise exception 'account accuracy does not meet this V1 challenge gate' using errcode='42501';
  end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'node_id',target_node_id,'topic_id',member.topic_id,'stage',stage,'stake',policy.stake::text,
    'scope',policy.scope,'accuracy_gate',policy.accuracy_gate
  )::text,'UTF8')),'hex');
  select id,request_hash into tx,existing_hash from public.energy_transactions
  where actor_id=actor and transaction_type='CHALLENGE_STAKE' and idempotency_key=operation_key;
  if tx is not null then
    if existing_hash is distinct from request_hash then raise exception 'idempotency key reused with different challenge request' using errcode='23505'; end if;
    select * into existing_round from private.knowledge_revalidation_rounds where initiator_stake_transaction_id=tx;
    if found then return private.knowledge_revalidation_snapshot(existing_round.node_id); end if;
    raise exception 'challenge idempotency transaction exists without round' using errcode='KB409';
  end if;

  select id into account_id from public.energy_accounts where user_id=actor for update;
  if account_id is null then raise exception 'energy account not found'; end if;
  update public.energy_accounts set balance=balance-policy.stake
    where id=account_id and balance-policy.stake>=-10.000000;
  if not found then raise exception 'insufficient energy for V1 challenge stake' using errcode='23514'; end if;
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('CHALLENGE_STAKE',operation_key,
    jsonb_build_object('operation','KNOWLEDGE_REVALIDATION','node_id',target_node_id,'topic_id',member.topic_id,
      'stage',stage,'stake',policy.stake::text,'scope',policy.scope,'accuracy_gate',policy.accuracy_gate),
    actor,request_hash) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id,account_id,amount) values
    (tx,account_id,-policy.stake),(tx,'00000000-0000-0000-0000-000000000001',policy.stake);
  update public.energy_accounts set balance=balance+policy.stake where id='00000000-0000-0000-0000-000000000001';

  select greatest(count(*),1)::bigint into snapshot from public.knowledge_ball_profiles where active;
  required:=public.pending_vote_required_for_snapshot(snapshot);
  select coalesce(max(round_no),0)+1 into next_round from private.knowledge_revalidation_rounds where topic_id=member.topic_id;
  insert into private.knowledge_revalidation_rounds(
    topic_id,node_id,round_no,role_at_start,stage,scope,accuracy_gate,local_hop_limit,stake,
    initiator_id,eligible_user_snapshot,required_votes,opened_at,deadline,initiator_stake_transaction_id
  ) values(
    member.topic_id,target_node_id,next_round,member.role,stage,policy.scope,policy.accuracy_gate,
    policy.local_hop_limit,policy.stake,actor,snapshot,required,opened,opened+interval '720 hours',tx
  ) returning * into r;
  perform private.emit_revalidation_started(r);
  perform public.assert_energy_conservation();
  return private.knowledge_revalidation_snapshot(target_node_id);
end $$;

create or replace function public.get_knowledge_revalidation(target_node_id text) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare r private.knowledge_revalidation_rounds%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into r from private.knowledge_revalidation_rounds where node_id=target_node_id order by round_no desc limit 1;
  if not found then raise exception 'revalidation round not found' using errcode='22023'; end if;
  if r.verdict='PENDING' then perform private.finalize_knowledge_revalidation(r.id); end if;
  return private.knowledge_revalidation_snapshot(target_node_id);
end $$;

create or replace function public.cast_knowledge_revalidation_vote(
  target_node_id text,vote_side text,operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  actor uuid:=auth.uid();
  r private.knowledge_revalidation_rounds%rowtype;
  accuracy numeric;
  account_id uuid;
  tx uuid;
  request_hash text;
  existing_hash text;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if vote_side not in ('AGREE','DISAGREE') or nullif(trim(operation_key),'') is null then raise exception 'invalid revalidation vote' using errcode='22023'; end if;
  perform public.ensure_anonymous_profile();
  select * into r from private.knowledge_revalidation_rounds where node_id=target_node_id and verdict='PENDING' order by round_no desc limit 1;
  if not found then return public.get_knowledge_revalidation(target_node_id); end if;
  perform pg_advisory_xact_lock(hashtextextended('knowledge-revalidation:'||r.topic_id,0));
  perform private.finalize_knowledge_revalidation(r.id);
  select * into r from private.knowledge_revalidation_rounds where id=r.id for update;
  if r.verdict<>'PENDING' then return private.knowledge_revalidation_snapshot(target_node_id); end if;
  if r.initiator_id=actor then raise exception 'challenge initiator cannot cast an ordinary vote in the same round' using errcode='42501'; end if;
  if exists(select 1 from private.knowledge_revalidation_votes where round_id=r.id and voter_id=actor) then
    return private.knowledge_revalidation_snapshot(target_node_id);
  end if;
  accuracy:=coalesce((public.get_my_account()->>'accuracy')::numeric,0);
  if r.accuracy_gate is not null and accuracy<r.accuracy_gate then
    raise exception 'account accuracy does not meet this V1 challenge gate' using errcode='42501';
  end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'round_id',r.id,'node_id',target_node_id,'side',vote_side,'stake',r.stake::text
  )::text,'UTF8')),'hex');
  select id,request_hash into tx,existing_hash from public.energy_transactions
  where actor_id=actor and transaction_type='CHALLENGE_VOTE_STAKE' and idempotency_key=operation_key;
  if tx is not null then
    if existing_hash is distinct from request_hash then raise exception 'idempotency key reused with different revalidation vote' using errcode='23505'; end if;
    return private.knowledge_revalidation_snapshot(target_node_id);
  end if;

  select id into account_id from public.energy_accounts where user_id=actor for update;
  update public.energy_accounts set balance=balance-r.stake where id=account_id and balance-r.stake>=-10.000000;
  if not found then raise exception 'insufficient energy for V1 challenge vote stake' using errcode='23514'; end if;
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('CHALLENGE_VOTE_STAKE',operation_key,
    jsonb_build_object('operation','KNOWLEDGE_REVALIDATION_VOTE','round_id',r.id,'node_id',target_node_id,
      'side',vote_side,'stage',r.stage,'stake',r.stake::text),actor,request_hash)
  returning id into tx;
  insert into public.energy_ledger_entries(transaction_id,account_id,amount) values
    (tx,account_id,-r.stake),(tx,'00000000-0000-0000-0000-000000000001',r.stake);
  update public.energy_accounts set balance=balance+r.stake where id='00000000-0000-0000-0000-000000000001';
  insert into private.knowledge_revalidation_votes(round_id,voter_id,side,stake,transaction_id)
  values(r.id,actor,vote_side,r.stake,tx);
  perform private.finalize_knowledge_revalidation(r.id);
  perform public.assert_energy_conservation();
  return private.knowledge_revalidation_snapshot(target_node_id);
end $$;

create or replace function public.settle_expired_knowledge_revalidations(max_rounds integer default 50) returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare rid uuid; processed integer:=0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if max_rounds<1 or max_rounds>200 then raise exception 'invalid settlement batch size' using errcode='22023'; end if;
  for rid in select id from private.knowledge_revalidation_rounds
    where verdict='PENDING' and deadline<=now() order by deadline,id limit max_rounds
  loop
    perform private.finalize_knowledge_revalidation(rid);
    processed:=processed+1;
  end loop;
  return processed;
end $$;

revoke all on function public.start_knowledge_revalidation(text,text),
  public.get_knowledge_revalidation(text),
  public.cast_knowledge_revalidation_vote(text,text,text),
  public.settle_expired_knowledge_revalidations(integer)
from public, anon, authenticated;
grant execute on function public.start_knowledge_revalidation(text,text),
  public.get_knowledge_revalidation(text),
  public.cast_knowledge_revalidation_vote(text,text,text),
  public.settle_expired_knowledge_revalidations(integer)
to authenticated;

-- Feature/schema gate for the deployed client.
create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path=public,pg_temp
as $$ select '202608220001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
