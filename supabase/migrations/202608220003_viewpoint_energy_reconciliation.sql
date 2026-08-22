-- Knowledge Lineage V3 / module 5: historical energy reconciliation.
--
-- A normal same-viewpoint optimization only advances the immutable current head;
-- it NEVER reopens old economic settlement. A whole viewpoint flip does.
-- For every historical funded position in the topic we compute:
--
--   delta = desired payout under the new viewpoint - already applied payout
--
-- and append that delta as one RECONCILIATION transaction. Old settlement and
-- stake transactions are immutable. Repeated delivery of the same viewpoint
-- event is idempotent, and a later flip can reverse an earlier reconciliation
-- by appending the opposite delta.

alter table public.energy_transactions drop constraint if exists energy_transactions_transaction_type_check;
alter table public.energy_transactions add constraint energy_transactions_transaction_type_check
  check(transaction_type in (
    'REFERRAL','SPEND','TRANSFER','VOTE_STAKE','CLAIM_STAKE','VOTE_SETTLEMENT',
    'CHALLENGE_STAKE','CHALLENGE_VOTE_STAKE','CHALLENGE_SETTLEMENT','RECONCILIATION'
  ));

-- A forced truth reconciliation cannot be allowed to fail merely because a
-- former winner already spent their reward. The -10 rule therefore remains a
-- hard gate on every voluntary debit RPC, but is no longer a storage-level
-- constraint on a server-authored reconciliation correction.
alter table public.energy_accounts drop constraint if exists energy_account_floor;
alter table public.energy_accounts drop constraint if exists energy_account_identity;
alter table public.energy_accounts add constraint energy_account_identity check (
  (account_type='USER' and user_id is not null)
  or (account_type='SYSTEM' and user_id is null)
);

create table private.knowledge_viewpoint_reconciliations (
  viewpoint_event_id text primary key,
  topic_id text not null,
  trigger_event_type text not null check(trigger_event_type in ('KnowledgeVerdictFinalized','KnowledgeRevalidationFinalized')),
  transaction_id uuid unique references public.energy_transactions(id),
  created_at timestamptz not null default now()
);
alter table private.knowledge_viewpoint_reconciliations enable row level security;
revoke all on private.knowledge_viewpoint_reconciliations from public, anon, authenticated;

create table private.knowledge_reconciliation_position_deltas (
  viewpoint_event_id text not null references private.knowledge_viewpoint_reconciliations(viewpoint_event_id),
  position_key text not null,
  topic_id text not null,
  node_id text not null,
  source_kind text not null check(source_kind in ('INITIAL','REVALIDATION')),
  source_round_id uuid not null,
  account_id uuid not null references public.energy_accounts(id),
  desired_payout numeric(30,6) not null,
  previous_applied_payout numeric(30,6) not null,
  delta numeric(30,6) not null check(delta<>0),
  transaction_id uuid not null references public.energy_transactions(id),
  created_at timestamptz not null default now(),
  primary key(viewpoint_event_id,position_key),
  check(delta=desired_payout-previous_applied_payout)
);
create index knowledge_reconciliation_position
  on private.knowledge_reconciliation_position_deltas(position_key,created_at);
create index knowledge_reconciliation_transaction
  on private.knowledge_reconciliation_position_deltas(transaction_id);
alter table private.knowledge_reconciliation_position_deltas enable row level security;
revoke all on private.knowledge_reconciliation_position_deltas from public, anon, authenticated;

-- Replays the exact V2 INITIAL settlement entitlement. Creator/system wager is
-- separate from the ordinary one-energy voter pool, matching 202608180004.
create or replace function private.initial_round_position_entitlements(
  target_round_id uuid,
  desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select * from public.knowledge_pending_vote_rounds where id=target_round_id
  ), valid_votes as (
    select v.id,v.voter_id,v.side,a.id as account_id,
      'initial:'||v.round_id::text||':vote:'||v.id::text as position_key
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=target_round_id and v.settlement_status='ACTIVE'
  ), params as (
    select
      case when desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      count(*) filter(where side=case when desired_verdict='CORRECT' then 'DISAGREE' else 'AGREE' end)::bigint as loser_count,
      count(*) filter(where side=case when desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count
    from valid_votes
  ), winner_ranks as (
    select v.id,row_number() over(order by v.position_key)::bigint-1 as winner_index
    from valid_votes v cross join params p
    where v.side=p.winning_side
  ), vote_entitlements as (
    select v.position_key,v.account_id,
      case when v.side=p.winning_side and p.winner_count>0 then
        (
          1000000::bigint
          +(p.loser_count*1000000::bigint)/p.winner_count
          +case when wr.winner_index < (p.loser_count*1000000::bigint)%p.winner_count then 1 else 0 end
        )::numeric/1000000
      else 0::numeric end::numeric(30,6) as payout
    from valid_votes v cross join params p
    left join winner_ranks wr on wr.id=v.id
  ), creator_entitlement as (
    select
      'initial:'||r.id::text||':creator:'||r.initiator_id::text as position_key,
      a.id as account_id,
      case when desired_verdict='CORRECT' then 2.000000 else 0.000000 end::numeric(30,6) as payout
    from r
    join public.energy_accounts a on a.user_id=r.initiator_id
    where not r.legacy_unfunded and r.creator_stake_transaction_id is not null
  )
  select * from creator_entitlement
  union all
  select * from vote_entitlements
  order by position_key
$$;

-- Replays the exact equal-stake V1 revalidation settlement. The human
-- initiator is an AGREE energy position and every ordinary ballot uses r.stake.
create or replace function private.revalidation_round_position_entitlements(
  target_round_id uuid,
  desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select * from private.knowledge_revalidation_rounds where id=target_round_id
  ), positions as (
    select
      'revalidation:'||r.id::text||':initiator:'||r.initiator_id::text as position_key,
      a.id as account_id,'AGREE'::text as side,r.stake
    from r join public.energy_accounts a on a.user_id=r.initiator_id
    union all
    select
      'revalidation:'||v.round_id::text||':vote:'||v.id::text,
      a.id,v.side,v.stake
    from private.knowledge_revalidation_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=target_round_id
  ), params as (
    select
      case when desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      count(*) filter(where side=case when desired_verdict='CORRECT' then 'DISAGREE' else 'AGREE' end)::bigint as loser_count,
      count(*) filter(where side=case when desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count,
      max(stake) as stake
    from positions
  ), winner_ranks as (
    select p.position_key,row_number() over(order by p.position_key)::bigint-1 as winner_index
    from positions p cross join params x where p.side=x.winning_side
  )
  select p.position_key,p.account_id,
    case when p.side=x.winning_side and x.winner_count>0 then
      (
        (x.stake*1000000)::bigint
        +(x.loser_count*(x.stake*1000000)::bigint)/x.winner_count
        +case when wr.winner_index < (x.loser_count*(x.stake*1000000)::bigint)%x.winner_count then 1 else 0 end
      )::numeric/1000000
    else 0::numeric end::numeric(30,6) as payout
  from positions p cross join params x
  left join winner_ranks wr on wr.position_key=p.position_key
  order by p.position_key
$$;

revoke all on function private.initial_round_position_entitlements(uuid,text),
  private.revalidation_round_position_entitlements(uuid,text)
from public,anon,authenticated;

create or replace function private.reconcile_knowledge_viewpoint(
  target_topic_id text,
  viewpoint_event_id text,
  trigger_event_type text,
  event_actor uuid
) returns void
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  claimed text;
  tx uuid;
  request_hash text;
  system_account constant uuid:='00000000-0000-0000-0000-000000000001';
  member record;
  round_row record;
  position record;
  desired_verdict text;
  prior_delta numeric(30,6);
  previous_applied numeric(30,6);
  position_delta numeric(30,6);
  total_user_delta numeric(30,6):=0.000000;
begin
  if trigger_event_type not in ('KnowledgeVerdictFinalized','KnowledgeRevalidationFinalized') then
    raise exception 'invalid reconciliation trigger event type' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('viewpoint-reconciliation:'||target_topic_id,0));

  insert into private.knowledge_viewpoint_reconciliations(
    viewpoint_event_id,topic_id,trigger_event_type
  ) values(viewpoint_event_id,target_topic_id,trigger_event_type)
  on conflict(viewpoint_event_id) do nothing
  returning viewpoint_event_id into claimed;
  if claimed is null then return; end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'viewpoint_event_id',viewpoint_event_id,'topic_id',target_topic_id,
    'trigger_event_type',trigger_event_type
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(
    transaction_type,idempotency_key,metadata,actor_id,request_hash
  ) values(
    'RECONCILIATION','viewpoint-reconciliation:'||viewpoint_event_id,
    jsonb_build_object(
      'operation','KNOWLEDGE_VIEWPOINT_RECONCILIATION',
      'viewpoint_event_id',viewpoint_event_id,'topic_id',target_topic_id,
      'trigger_event_type',trigger_event_type
    ),event_actor,request_hash
  ) returning id into tx;

  for member in
    select node_id,role
    from private.knowledge_lineage_members
    where topic_id=target_topic_id and role in ('current','history','opposition')
    order by role,rank,node_id
  loop
    desired_verdict:=case when member.role='opposition' then 'INCORRECT' else 'CORRECT' end;

    -- INITIAL V2 positions. Usually one round per immutable node.
    for round_row in
      select id,node_id,verdict
      from public.knowledge_pending_vote_rounds
      where node_id=member.node_id and verdict in ('CORRECT','INCORRECT')
      order by round_no,id
    loop
      for position in
        with desired as (
          select * from private.initial_round_position_entitlements(round_row.id,desired_verdict)
        ), original as (
          select * from private.initial_round_position_entitlements(round_row.id,round_row.verdict)
        )
        select d.position_key,d.account_id,d.payout as desired_payout,o.payout as original_payout
        from desired d join original o using(position_key,account_id)
        order by d.position_key
      loop
        select coalesce(sum(delta),0.000000)::numeric(30,6) into prior_delta
        from private.knowledge_reconciliation_position_deltas
        where position_key=position.position_key;
        previous_applied:=(position.original_payout+prior_delta)::numeric(30,6);
        position_delta:=(position.desired_payout-previous_applied)::numeric(30,6);
        if position_delta<>0 then
          insert into private.knowledge_reconciliation_position_deltas(
            viewpoint_event_id,position_key,topic_id,node_id,source_kind,source_round_id,
            account_id,desired_payout,previous_applied_payout,delta,transaction_id
          ) values(
            viewpoint_event_id,position.position_key,target_topic_id,round_row.node_id,'INITIAL',round_row.id,
            position.account_id,position.desired_payout,previous_applied,position_delta,tx
          );
          update public.energy_accounts set balance=balance+position_delta where id=position.account_id;
          insert into public.energy_ledger_entries(transaction_id,account_id,amount)
          values(tx,position.account_id,position_delta);
          total_user_delta:=total_user_delta+position_delta;
        end if;
      end loop;
    end loop;

    -- Every finalized later V1 challenge on the immutable node is a separate
    -- historical energy pool and is reconciled independently.
    for round_row in
      select id,node_id,verdict
      from private.knowledge_revalidation_rounds
      where node_id=member.node_id and verdict in ('CORRECT','INCORRECT')
      order by round_no,id
    loop
      for position in
        with desired as (
          select * from private.revalidation_round_position_entitlements(round_row.id,desired_verdict)
        ), original as (
          select * from private.revalidation_round_position_entitlements(round_row.id,round_row.verdict)
        )
        select d.position_key,d.account_id,d.payout as desired_payout,o.payout as original_payout
        from desired d join original o using(position_key,account_id)
        order by d.position_key
      loop
        select coalesce(sum(delta),0.000000)::numeric(30,6) into prior_delta
        from private.knowledge_reconciliation_position_deltas
        where position_key=position.position_key;
        previous_applied:=(position.original_payout+prior_delta)::numeric(30,6);
        position_delta:=(position.desired_payout-previous_applied)::numeric(30,6);
        if position_delta<>0 then
          insert into private.knowledge_reconciliation_position_deltas(
            viewpoint_event_id,position_key,topic_id,node_id,source_kind,source_round_id,
            account_id,desired_payout,previous_applied_payout,delta,transaction_id
          ) values(
            viewpoint_event_id,position.position_key,target_topic_id,round_row.node_id,'REVALIDATION',round_row.id,
            position.account_id,position.desired_payout,previous_applied,position_delta,tx
          );
          update public.energy_accounts set balance=balance+position_delta where id=position.account_id;
          insert into public.energy_ledger_entries(transaction_id,account_id,amount)
          values(tx,position.account_id,position_delta);
          total_user_delta:=total_user_delta+position_delta;
        end if;
      end loop;
    end loop;
  end loop;

  if total_user_delta<>0 then
    update public.energy_accounts set balance=balance-total_user_delta where id=system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
    values(tx,system_account,-total_user_delta);
  end if;

  update private.knowledge_viewpoint_reconciliations
  set transaction_id=tx where viewpoint_event_id=viewpoint_event_id;
  perform public.assert_energy_conservation();
end $$;
revoke all on function private.reconcile_knowledge_viewpoint(text,text,text,uuid)
from public,anon,authenticated;

-- Must run after module-4's project_knowledge_lineage_event AFTER trigger. Trigger
-- names are ordered, therefore the zz_ prefix observes the already-swapped roles.
create or replace function private.reconcile_knowledge_viewpoint_event() returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  target_node_id text;
  target_topic_id text;
  proposal text;
  start_role text;
  round_id uuid;
begin
  if new.event_type='KnowledgeVerdictFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    target_node_id:=new.envelope#>>'{payload,nodeId}';
    select topic_id,proposal into target_topic_id,proposal
    from private.knowledge_lineage_members
    where node_id=target_node_id and role='current';
    if proposal='opposition' then
      perform private.reconcile_knowledge_viewpoint(
        target_topic_id,new.event_id,new.event_type,new.actor_id
      );
    end if;
    return new;
  end if;

  if new.event_type='KnowledgeRevalidationFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    round_id:=(new.envelope#>>'{payload,roundId}')::uuid;
    select topic_id,role_at_start into target_topic_id,start_role
    from private.knowledge_revalidation_rounds where id=round_id;
    if start_role='opposition' then
      perform private.reconcile_knowledge_viewpoint(
        target_topic_id,new.event_id,new.event_type,new.actor_id
      );
    end if;
    return new;
  end if;

  return new;
end $$;
revoke all on function private.reconcile_knowledge_viewpoint_event()
from public,anon,authenticated;

drop trigger if exists zz_reconcile_knowledge_viewpoint_flip on public.public_knowledge_events;
create trigger zz_reconcile_knowledge_viewpoint_flip
after insert on public.public_knowledge_events
for each row execute function private.reconcile_knowledge_viewpoint_event();

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path=public,pg_temp
as $$ select '202608220003'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
