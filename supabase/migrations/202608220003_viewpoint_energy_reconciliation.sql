-- Knowledge Lineage V3 / module 5: historical energy reconciliation.
--
-- Scope boundary:
-- - same-viewpoint optimization/history reactivation: no historical resettlement
-- - whole viewpoint flip only: append delta corrections for existing funded positions
-- - old stake/settlement/ledger rows are never updated or deleted
-- - validation, DAG propagation, visibility and detail UI are not changed here
--
-- For every historical funded position in the topic:
--   delta = desired payout under the new final viewpoint - already applied payout
-- The delta is appended in a RECONCILIATION transaction. Replaying the same
-- viewpoint event is idempotent; a later flip appends the reverse delta as needed.

alter table public.energy_transactions drop constraint if exists energy_transactions_transaction_type_check;
alter table public.energy_transactions add constraint energy_transactions_transaction_type_check
  check(transaction_type in (
    'REFERRAL','SPEND','TRANSFER','VOTE_STAKE','CLAIM_STAKE','VOTE_SETTLEMENT',
    'CHALLENGE_STAKE','CHALLENGE_VOTE_STAKE','CHALLENGE_SETTLEMENT','RECONCILIATION'
  ));

-- The product rule is that a USER may not voluntarily spend/stake/transfer past
-- -10. Every existing voluntary debit RPC keeps its explicit balance-amount>=-10
-- guard. A server-authored historical correction is not a new voluntary spend;
-- it must remain able to claw back an already-spent historical reward, otherwise
-- a former winner could block a truth flip by spending first. Keep identity as a
-- storage invariant while the -10 rule remains enforced at voluntary debit APIs.
alter table public.energy_accounts drop constraint if exists energy_account_floor;
alter table public.energy_accounts drop constraint if exists energy_account_identity;
alter table public.energy_accounts add constraint energy_account_identity check (
  (account_type='USER' and user_id is not null)
  or (account_type='SYSTEM' and user_id is null)
);

create table private.knowledge_viewpoint_reconciliations (
  viewpoint_event_id text primary key,
  topic_id text not null,
  trigger_event_type text not null
    check(trigger_event_type in ('KnowledgeVerdictFinalized','KnowledgeRevalidationFinalized')),
  transaction_id uuid unique references public.energy_transactions(id),
  created_at timestamptz not null default now()
);
alter table private.knowledge_viewpoint_reconciliations enable row level security;
revoke all on private.knowledge_viewpoint_reconciliations from public, anon, authenticated;

create table private.knowledge_reconciliation_position_deltas (
  viewpoint_event_id text not null
    references private.knowledge_viewpoint_reconciliations(viewpoint_event_id),
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

-- Exact V2 INITIAL entitlement replay. The creator/system wager is intentionally
-- separate from the ordinary one-energy voter pool, matching 202608180004.
create or replace function private.initial_round_position_entitlements(
  p_round_id uuid,
  p_desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select pr.*
    from public.knowledge_pending_vote_rounds pr
    where pr.id=p_round_id
      and p_desired_verdict in ('CORRECT','INCORRECT')
  ), valid_votes as (
    select
      v.id,
      v.side,
      a.id as account_id,
      'initial:'||v.round_id::text||':vote:'||v.id::text as position_key
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=p_round_id
      and v.settlement_status='ACTIVE'
  ), params as (
    select
      case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'DISAGREE' else 'AGREE' end)::bigint as loser_count,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count
    from valid_votes
  ), winner_ranks as (
    select
      v.id,
      row_number() over(order by v.position_key)::bigint-1 as winner_index
    from valid_votes v
    cross join params p
    where v.side=p.winning_side
  ), vote_entitlements as (
    select
      v.position_key,
      v.account_id,
      case when v.side=p.winning_side and p.winner_count>0 then
        (
          1000000::bigint
          +(p.loser_count*1000000::bigint)/p.winner_count
          +case when wr.winner_index < (p.loser_count*1000000::bigint)%p.winner_count then 1 else 0 end
        )::numeric/1000000
      else 0::numeric end::numeric(30,6) as payout
    from valid_votes v
    cross join params p
    left join winner_ranks wr on wr.id=v.id
  ), creator_entitlement as (
    select
      'initial:'||r.id::text||':creator:'||r.initiator_id::text as position_key,
      a.id as account_id,
      case when p_desired_verdict='CORRECT' then 2.000000 else 0.000000 end::numeric(30,6) as payout
    from r
    join public.energy_accounts a on a.user_id=r.initiator_id
    where not r.legacy_unfunded
      and r.creator_stake_transaction_id is not null
  )
  select * from creator_entitlement
  union all
  select * from vote_entitlements
  order by position_key
$$;

-- Exact V1 revalidation entitlement replay. The human initiator is an AGREE
-- energy position and every ordinary ballot uses the frozen round stake.
create or replace function private.revalidation_round_position_entitlements(
  p_round_id uuid,
  p_desired_verdict text
) returns table(position_key text,account_id uuid,payout numeric(30,6))
language sql
stable
security definer
set search_path=private,public,pg_temp
as $$
  with r as (
    select rr.*
    from private.knowledge_revalidation_rounds rr
    where rr.id=p_round_id
      and p_desired_verdict in ('CORRECT','INCORRECT')
  ), positions as (
    select
      'revalidation:'||r.id::text||':initiator:'||r.initiator_id::text as position_key,
      a.id as account_id,
      'AGREE'::text as side
    from r
    join public.energy_accounts a on a.user_id=r.initiator_id
    union all
    select
      'revalidation:'||v.round_id::text||':vote:'||v.id::text,
      a.id,
      v.side
    from private.knowledge_revalidation_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=p_round_id
  ), params as (
    select
      case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end as winning_side,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'DISAGREE' else 'AGREE' end)::bigint as loser_count,
      count(*) filter(where side=case when p_desired_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end)::bigint as winner_count,
      (select stake from r) as stake
    from positions
  ), winner_ranks as (
    select
      p.position_key,
      row_number() over(order by p.position_key)::bigint-1 as winner_index
    from positions p
    cross join params x
    where p.side=x.winning_side
  )
  select
    p.position_key,
    p.account_id,
    case when p.side=x.winning_side and x.winner_count>0 then
      (
        (x.stake*1000000)::bigint
        +(x.loser_count*(x.stake*1000000)::bigint)/x.winner_count
        +case when wr.winner_index < (x.loser_count*(x.stake*1000000)::bigint)%x.winner_count then 1 else 0 end
      )::numeric/1000000
    else 0::numeric end::numeric(30,6) as payout
  from positions p
  cross join params x
  left join winner_ranks wr on wr.position_key=p.position_key
  order by p.position_key
$$;

revoke all on function private.initial_round_position_entitlements(uuid,text),
  private.revalidation_round_position_entitlements(uuid,text)
from public,anon,authenticated;

create or replace function private.reconcile_knowledge_viewpoint(
  p_topic_id text,
  p_viewpoint_event_id text,
  p_trigger_event_type text,
  p_event_actor uuid
) returns void
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  v_claimed_rows integer:=0;
  v_tx uuid;
  v_request_hash text;
  v_system_account constant uuid:='00000000-0000-0000-0000-000000000001';
  v_member record;
  v_round record;
  v_position record;
  v_lock record;
  v_desired_verdict text;
  v_prior_delta numeric(30,6);
  v_previous_applied numeric(30,6);
  v_delta numeric(30,6);
  v_total_user_delta numeric(30,6):=0.000000;
begin
  if nullif(p_topic_id,'') is null or nullif(p_viewpoint_event_id,'') is null then
    raise exception 'reconciliation requires topic and event id' using errcode='22023';
  end if;
  if p_trigger_event_type not in ('KnowledgeVerdictFinalized','KnowledgeRevalidationFinalized') then
    raise exception 'invalid reconciliation trigger event type' using errcode='22023';
  end if;

  -- One viewpoint transition per topic at a time.
  perform pg_advisory_xact_lock(hashtextextended('viewpoint-reconciliation:'||p_topic_id,0));

  insert into private.knowledge_viewpoint_reconciliations(
    viewpoint_event_id,topic_id,trigger_event_type
  ) values(p_viewpoint_event_id,p_topic_id,p_trigger_event_type)
  on conflict(viewpoint_event_id) do nothing;
  get diagnostics v_claimed_rows = row_count;
  if v_claimed_rows=0 then return; end if;

  -- Lock every involved USER account in the same user_id order used by transfer
  -- hardening, then SYSTEM last. This prevents cross-topic reconciliation from
  -- introducing a new lock-order cycle against existing debit RPCs.
  for v_lock in
    with member_nodes as (
      select m.node_id
      from private.knowledge_lineage_members m
      where m.topic_id=p_topic_id
        and m.role in ('current','history','opposition')
    ), participant_users as (
      select pr.initiator_id as user_id
      from public.knowledge_pending_vote_rounds pr
      join member_nodes mn on mn.node_id=pr.node_id
      where pr.verdict in ('CORRECT','INCORRECT')
        and not pr.legacy_unfunded
        and pr.creator_stake_transaction_id is not null
      union
      select pv.voter_id
      from public.knowledge_pending_votes pv
      join public.knowledge_pending_vote_rounds pr on pr.id=pv.round_id
      join member_nodes mn on mn.node_id=pr.node_id
      where pr.verdict in ('CORRECT','INCORRECT')
        and pv.settlement_status='ACTIVE'
      union
      select rr.initiator_id
      from private.knowledge_revalidation_rounds rr
      join member_nodes mn on mn.node_id=rr.node_id
      where rr.verdict in ('CORRECT','INCORRECT')
      union
      select rv.voter_id
      from private.knowledge_revalidation_votes rv
      join private.knowledge_revalidation_rounds rr on rr.id=rv.round_id
      join member_nodes mn on mn.node_id=rr.node_id
      where rr.verdict in ('CORRECT','INCORRECT')
    )
    select a.id,a.user_id
    from public.energy_accounts a
    join participant_users p on p.user_id=a.user_id
    order by a.user_id
    for update of a
  loop
    null;
  end loop;
  perform 1 from public.energy_accounts a where a.id=v_system_account for update;

  v_request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'viewpoint_event_id',p_viewpoint_event_id,
    'topic_id',p_topic_id,
    'trigger_event_type',p_trigger_event_type
  )::text,'UTF8')),'hex');

  insert into public.energy_transactions(
    transaction_type,idempotency_key,metadata,actor_id,request_hash
  ) values(
    'RECONCILIATION',
    'viewpoint-reconciliation:'||p_viewpoint_event_id,
    jsonb_build_object(
      'operation','KNOWLEDGE_VIEWPOINT_RECONCILIATION',
      'viewpoint_event_id',p_viewpoint_event_id,
      'topic_id',p_topic_id,
      'trigger_event_type',p_trigger_event_type
    ),
    p_event_actor,
    v_request_hash
  ) returning id into v_tx;

  for v_member in
    select m.node_id,m.role
    from private.knowledge_lineage_members m
    where m.topic_id=p_topic_id
      and m.role in ('current','history','opposition')
    order by m.role,m.rank,m.node_id
  loop
    v_desired_verdict:=case when v_member.role='opposition' then 'INCORRECT' else 'CORRECT' end;

    -- INITIAL V2 positions. Rejected candidates are absent from the formal
    -- lineage and therefore deliberately absent from historical flip settlement.
    for v_round in
      select pr.id,pr.node_id,pr.verdict
      from public.knowledge_pending_vote_rounds pr
      where pr.node_id=v_member.node_id
        and pr.verdict in ('CORRECT','INCORRECT')
        and pr.settlement_transaction_id is not null
      order by pr.round_no,pr.id
    loop
      for v_position in
        with desired as (
          select * from private.initial_round_position_entitlements(v_round.id,v_desired_verdict)
        ), original as (
          select * from private.initial_round_position_entitlements(v_round.id,v_round.verdict)
        )
        select
          d.position_key,
          d.account_id,
          d.payout as desired_payout,
          o.payout as original_payout
        from desired d
        join original o using(position_key,account_id)
        order by d.position_key
      loop
        select coalesce(sum(d.delta),0.000000)::numeric(30,6)
        into v_prior_delta
        from private.knowledge_reconciliation_position_deltas d
        where d.position_key=v_position.position_key;

        v_previous_applied:=(v_position.original_payout+v_prior_delta)::numeric(30,6);
        v_delta:=(v_position.desired_payout-v_previous_applied)::numeric(30,6);

        if v_delta<>0 then
          insert into private.knowledge_reconciliation_position_deltas(
            viewpoint_event_id,position_key,topic_id,node_id,source_kind,source_round_id,
            account_id,desired_payout,previous_applied_payout,delta,transaction_id
          ) values(
            p_viewpoint_event_id,
            v_position.position_key,
            p_topic_id,
            v_round.node_id,
            'INITIAL',
            v_round.id,
            v_position.account_id,
            v_position.desired_payout,
            v_previous_applied,
            v_delta,
            v_tx
          );
          update public.energy_accounts a
          set balance=a.balance+v_delta
          where a.id=v_position.account_id;
          insert into public.energy_ledger_entries(transaction_id,account_id,amount)
          values(v_tx,v_position.account_id,v_delta);
          v_total_user_delta:=v_total_user_delta+v_delta;
        end if;
      end loop;
    end loop;

    -- Every finalized V1 challenge is an independent historical energy pool.
    for v_round in
      select rr.id,rr.node_id,rr.verdict
      from private.knowledge_revalidation_rounds rr
      where rr.node_id=v_member.node_id
        and rr.verdict in ('CORRECT','INCORRECT')
        and rr.settlement_transaction_id is not null
      order by rr.round_no,rr.id
    loop
      for v_position in
        with desired as (
          select * from private.revalidation_round_position_entitlements(v_round.id,v_desired_verdict)
        ), original as (
          select * from private.revalidation_round_position_entitlements(v_round.id,v_round.verdict)
        )
        select
          d.position_key,
          d.account_id,
          d.payout as desired_payout,
          o.payout as original_payout
        from desired d
        join original o using(position_key,account_id)
        order by d.position_key
      loop
        select coalesce(sum(d.delta),0.000000)::numeric(30,6)
        into v_prior_delta
        from private.knowledge_reconciliation_position_deltas d
        where d.position_key=v_position.position_key;

        v_previous_applied:=(v_position.original_payout+v_prior_delta)::numeric(30,6);
        v_delta:=(v_position.desired_payout-v_previous_applied)::numeric(30,6);

        if v_delta<>0 then
          insert into private.knowledge_reconciliation_position_deltas(
            viewpoint_event_id,position_key,topic_id,node_id,source_kind,source_round_id,
            account_id,desired_payout,previous_applied_payout,delta,transaction_id
          ) values(
            p_viewpoint_event_id,
            v_position.position_key,
            p_topic_id,
            v_round.node_id,
            'REVALIDATION',
            v_round.id,
            v_position.account_id,
            v_position.desired_payout,
            v_previous_applied,
            v_delta,
            v_tx
          );
          update public.energy_accounts a
          set balance=a.balance+v_delta
          where a.id=v_position.account_id;
          insert into public.energy_ledger_entries(transaction_id,account_id,amount)
          values(v_tx,v_position.account_id,v_delta);
          v_total_user_delta:=v_total_user_delta+v_delta;
        end if;
      end loop;
    end loop;
  end loop;

  if v_total_user_delta<>0 then
    update public.energy_accounts a
    set balance=a.balance-v_total_user_delta
    where a.id=v_system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
    values(v_tx,v_system_account,-v_total_user_delta);
  end if;

  update private.knowledge_viewpoint_reconciliations r
  set transaction_id=v_tx
  where r.viewpoint_event_id=p_viewpoint_event_id;

  perform public.assert_energy_conservation();
end $$;
revoke all on function private.reconcile_knowledge_viewpoint(text,text,text,uuid)
from public,anon,authenticated;

-- PostgreSQL executes same-kind triggers alphabetically by trigger name. The
-- zz_ prefix therefore observes module-4 project_knowledge_lineage_event after
-- it has already swapped current/history/opposition roles.
create or replace function private.reconcile_knowledge_viewpoint_event() returns trigger
language plpgsql
security definer
set search_path=private,public,pg_temp
as $$
declare
  v_node_id text;
  v_topic_id text;
  v_proposal text;
  v_role_at_start text;
  v_round_id uuid;
begin
  if new.event_type='KnowledgeVerdictFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    v_node_id:=new.envelope#>>'{payload,nodeId}';
    select m.topic_id,m.proposal
    into v_topic_id,v_proposal
    from private.knowledge_lineage_members m
    where m.node_id=v_node_id
      and m.role='current';

    if v_proposal='opposition' then
      perform private.reconcile_knowledge_viewpoint(
        v_topic_id,new.event_id,new.event_type,new.actor_id
      );
    end if;
    return new;
  end if;

  if new.event_type='KnowledgeRevalidationFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    v_round_id:=(new.envelope#>>'{payload,roundId}')::uuid;
    select rr.topic_id,rr.role_at_start
    into v_topic_id,v_role_at_start
    from private.knowledge_revalidation_rounds rr
    where rr.id=v_round_id;

    if v_role_at_start='opposition' then
      perform private.reconcile_knowledge_viewpoint(
        v_topic_id,new.event_id,new.event_type,new.actor_id
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
