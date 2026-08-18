-- ORIGINAL_DESIGN_V2 first-round adjudication.
--
-- V1 remains immutable in TypeScript for replay/history, but the vote-round
-- migrations from PR #66 have never been applied to any hosted Supabase
-- environment. This final migration therefore promotes every still-pending
-- first round to V2 before hosted settlement is enabled for the first time.
--
-- V2 rule: a claim must earn the snapshotted AGREE threshold within exactly
-- 720 hours. If neither ordinary side reaches threshold by the deadline, the
-- claim is INCORRECT. Silence is not evidence of correctness.

alter table public.knowledge_pending_vote_rounds
  drop constraint if exists knowledge_pending_vote_rounds_policy_version_check;
alter table public.knowledge_pending_vote_rounds
  alter column policy_version set default 'ORIGINAL_DESIGN_V2';
update public.knowledge_pending_vote_rounds
set policy_version='ORIGINAL_DESIGN_V2'
where verdict='PENDING';
alter table public.knowledge_pending_vote_rounds
  add constraint knowledge_pending_vote_rounds_policy_version_check
  check (policy_version in ('ORIGINAL_DESIGN_V1','ORIGINAL_DESIGN_V2'));

-- Preserve impossible historical ballots for audit rather than deleting them.
-- VOID_LATE: the correct system would already have closed the round.
-- VOID_CREATOR: the creator already owns the creator/system wager position and
-- must not also gain an ordinary vote on the same first-round claim.
alter table public.knowledge_pending_votes
  add column settlement_status text not null default 'ACTIVE'
    check (settlement_status in ('ACTIVE','VOID_LATE','VOID_CREATOR')),
  add column refunded_transaction_id uuid references public.energy_transactions(id);
create index knowledge_pending_votes_active_round_side
  on public.knowledge_pending_votes(round_id,side,created_at,id)
  where settlement_status='ACTIVE';

create or replace function public.pending_vote_round_for_node(target_node_id text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  result_id uuid;
  birth_actor uuid;
  birth_at timestamptz;
  user_snapshot bigint;
begin
  select id into result_id from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and round_no=1;
  if result_id is not null then return result_id; end if;
  if not public.is_pending_knowledge_node(target_node_id) then
    raise exception 'node is not pending or has not synchronized yet' using errcode='22023';
  end if;

  select actor_id,created_at into birth_actor,birth_at
  from (
    select sequence,actor_id,created_at from public.public_knowledge_events
      where event_type='KnowledgeAdded' and (
        envelope#>>'{payload,edit,node,id}'=target_node_id
        or envelope#>>'{payload,edit,reasoning,id}'=target_node_id
        or envelope#>>'{payload,edit,conclusion,id}'=target_node_id
      )
    union all
    select sequence,actor_id,created_at from public.public_knowledge_events
      where event_type='NodeCreated' and envelope#>>'{payload,nodeId}'=target_node_id
  ) birth
  order by sequence limit 1;
  if birth_actor is null then raise exception 'pending node birth event not found' using errcode='22023'; end if;

  select greatest(count(*),1)::bigint into user_snapshot
  from public.knowledge_ball_profiles where created_at<=birth_at;
  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,legacy_unfunded
  ) values(
    target_node_id,1,'ORIGINAL_DESIGN_V2',birth_actor,'AGREE',
    user_snapshot,public.pending_vote_required_for_snapshot(user_snapshot),
    birth_at,birth_at+interval '720 hours',true
  ) on conflict(node_id,round_no) do update set node_id=excluded.node_id
  returning id into result_id;
  return result_id;
end $$;

create or replace function public.fund_new_pending_vote_round(
  target_node_id text,
  creator uuid,
  opened timestamptz,
  source_event_id text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  result_id uuid;
  user_snapshot bigint;
  creator_account uuid;
  tx uuid;
  stake_amount numeric(30,6) := 1.000000;
  op_key text := 'claim-stake:'||source_event_id||':'||target_node_id;
  request_hash text;
begin
  if auth.uid() is null or creator<>auth.uid() then
    raise exception 'creator must match authenticated event actor' using errcode='42501';
  end if;
  perform public.ensure_anonymous_profile();
  select id into result_id from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and round_no=1;
  if result_id is not null then return result_id; end if;

  select greatest(count(*),1)::bigint into user_snapshot
    from public.knowledge_ball_profiles where active;
  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,legacy_unfunded
  ) values(
    target_node_id,1,'ORIGINAL_DESIGN_V2',creator,'AGREE',
    user_snapshot,public.pending_vote_required_for_snapshot(user_snapshot),
    opened,opened+interval '720 hours',false
  ) returning id into result_id;

  select id into creator_account from public.energy_accounts where user_id=creator for update;
  if creator_account is null then raise exception 'creator energy account not found'; end if;
  update public.energy_accounts set balance=balance-stake_amount
    where id=creator_account and balance-stake_amount>=-10.000000;
  if not found then raise exception 'insufficient energy for creator stake' using errcode='23514'; end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'node_id',target_node_id,'stake',stake_amount::text,'policy_version','ORIGINAL_DESIGN_V2'
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('CLAIM_STAKE',op_key,
    jsonb_build_object('operation','PENDING_CLAIM','node_id',target_node_id,
      'stake',stake_amount::text,'policy_version','ORIGINAL_DESIGN_V2'),
    creator,request_hash)
  returning id into tx;
  insert into public.energy_ledger_entries(transaction_id,account_id,amount) values
    (tx,creator_account,-stake_amount),
    (tx,'00000000-0000-0000-0000-000000000001',stake_amount);
  update public.energy_accounts set balance=balance+stake_amount where account_type='SYSTEM';
  update public.knowledge_pending_vote_rounds set creator_stake_transaction_id=tx where id=result_id;
  perform public.assert_energy_conservation();
  return result_id;
end $$;

create or replace function public.finalize_pending_vote_round(target_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  round_row public.knowledge_pending_vote_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  agree_threshold_at timestamptz;
  disagree_threshold_at timestamptz;
  agree_threshold_id uuid;
  disagree_threshold_id uuid;
  closure_at timestamptz;
  closure_id uuid;
  decided_verdict text;
  decided_reason text;
  winning_side text;
  funded boolean;
  losing_atoms bigint;
  winner_count bigint;
  share_atoms bigint := 0;
  remainder_atoms bigint := 0;
  position_index bigint := 0;
  winner record;
  void_vote record;
  payout_atoms bigint;
  payout numeric(30,6);
  total_payout numeric(30,6) := 0.000000;
  creator_payout numeric(30,6) := 0.000000;
  creator_account uuid;
  tx uuid;
  system_account constant uuid := '00000000-0000-0000-0000-000000000001';
  trigger_actor uuid;
  request_hash text;
  verdict_event jsonb;
begin
  select * into round_row from public.knowledge_pending_vote_rounds
    where id=target_round_id for update;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;

  if round_row.verdict<>'PENDING' then
    select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
      into agree_count,disagree_count
    from public.knowledge_pending_votes
    where round_id=round_row.id and settlement_status='ACTIVE';
    return jsonb_build_object('verdict',round_row.verdict,'close_reason',round_row.close_reason,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  -- A creator already has the creator/system wager and cannot also occupy an
  -- ordinary voting position. Historical rows created by the old RPC are kept
  -- for audit and refunded instead of being treated as losers.
  update public.knowledge_pending_votes
  set settlement_status='VOID_CREATOR'
  where round_id=round_row.id and voter_id=round_row.initiator_id
    and settlement_status='ACTIVE';

  -- Ballots after the exact 720-hour deadline could never have been accepted by
  -- the correct V2 RPC. Keep and refund them, but never let them change verdicts.
  update public.knowledge_pending_votes
  set settlement_status='VOID_LATE'
  where round_id=round_row.id and settlement_status='ACTIVE'
    and created_at>round_row.deadline;

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  -- Reconstruct the exact ballot that first reached each frozen threshold. This
  -- handles historical data where the old implementation accepted later votes.
  select created_at,id into agree_threshold_at,agree_threshold_id
  from public.knowledge_pending_votes
  where round_id=round_row.id and side='AGREE' and settlement_status='ACTIVE'
  order by created_at,id
  offset greatest(round_row.required_votes-1,0) limit 1;

  select created_at,id into disagree_threshold_at,disagree_threshold_id
  from public.knowledge_pending_votes
  where round_id=round_row.id and side='DISAGREE' and settlement_status='ACTIVE'
  order by created_at,id
  offset greatest(round_row.required_votes-1,0) limit 1;

  if agree_threshold_id is not null or disagree_threshold_id is not null then
    if disagree_threshold_id is null
       or (agree_threshold_id is not null and (
         agree_threshold_at<disagree_threshold_at
         or (agree_threshold_at=disagree_threshold_at and agree_threshold_id::text<disagree_threshold_id::text)
       )) then
      decided_verdict := 'CORRECT';
      closure_at := agree_threshold_at;
      closure_id := agree_threshold_id;
    else
      decided_verdict := 'INCORRECT';
      closure_at := disagree_threshold_at;
      closure_id := disagree_threshold_id;
    end if;
    decided_reason := 'THRESHOLD';

    update public.knowledge_pending_votes
    set settlement_status='VOID_LATE'
    where round_id=round_row.id and settlement_status='ACTIVE' and (
      created_at>closure_at or (created_at=closure_at and id::text>closure_id::text)
    );
  elsif now()>=round_row.deadline then
    -- V2 cleanliness rule: insufficient support is failure, regardless of
    -- majority or whether anyone bothered to cast a DISAGREE ballot.
    decided_verdict := 'INCORRECT';
    decided_reason := 'TIMEOUT';
  else
    return jsonb_build_object('verdict','PENDING','close_reason',null,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  -- Recount after impossible historical positions have been excluded.
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  winning_side := case when decided_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end;
  funded := not round_row.legacy_unfunded and round_row.creator_stake_transaction_id is not null;

  -- Ordinary voter pool is independent from the creator/system wager.
  -- On a V2 timeout with zero DISAGREE voters, winner_count is zero; no payout
  -- is created and all failed AGREE stakes therefore remain in SYSTEM.
  if winning_side='AGREE' then
    losing_atoms := disagree_count::bigint*1000000;
    winner_count := agree_count::bigint;
  else
    losing_atoms := agree_count::bigint*1000000;
    winner_count := disagree_count::bigint;
  end if;
  if winner_count>0 then
    share_atoms := losing_atoms/winner_count;
    remainder_atoms := losing_atoms%winner_count;
  end if;

  trigger_actor := coalesce(auth.uid(),round_row.initiator_id);
  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'round_id',round_row.id,'verdict',decided_verdict,'agree_count',agree_count,
    'disagree_count',disagree_count,'required_votes',round_row.required_votes,
    'policy_version',round_row.policy_version,
    'timeout_model','INSUFFICIENT_SUPPORT_FAILS',
    'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER',
    'invalid_vote_policy','REFUND'
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_SETTLEMENT','vote-settlement:'||round_row.id::text,
    jsonb_build_object('operation','PENDING_VOTE_SETTLEMENT','round_id',round_row.id,
      'node_id',round_row.node_id,'verdict',decided_verdict,'reason',decided_reason,
      'policy_version',round_row.policy_version,
      'timeout_model','INSUFFICIENT_SUPPORT_FAILS',
      'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER','invalid_vote_policy','REFUND'),
    trigger_actor,request_hash)
  returning id into tx;

  -- Refund every historical ballot the correct system would have rejected.
  for void_vote in
    select v.id,v.stake,a.id as account_id
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=round_row.id and v.settlement_status<>'ACTIVE'
      and v.refunded_transaction_id is null
    order by v.created_at,v.id
  loop
    update public.energy_accounts set balance=balance+void_vote.stake where id=void_vote.account_id;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,void_vote.account_id,void_vote.stake);
    update public.knowledge_pending_votes set refunded_transaction_id=tx where id=void_vote.id;
    total_payout := total_payout+void_vote.stake;
  end loop;

  if winner_count>0 then
    for winner in
      select 'vote:'||v.id::text as position_key,a.id as account_id
      from public.knowledge_pending_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=round_row.id and v.side=winning_side and v.settlement_status='ACTIVE'
      order by position_key
    loop
      position_index := position_index+1;
      payout_atoms := 1000000+share_atoms+case when position_index<=remainder_atoms then 1 else 0 end;
      payout := (payout_atoms::numeric/1000000)::numeric(30,6);
      update public.energy_accounts set balance=balance+payout where id=winner.account_id;
      insert into public.energy_ledger_entries(transaction_id,account_id,amount)
        values(tx,winner.account_id,payout);
      total_payout := total_payout+payout;
    end loop;
  end if;

  -- Creator/system wager remains separate. Correct => creator receives their
  -- locked 1 energy plus exactly +1 from SYSTEM. Incorrect/timeout => the locked
  -- creator stake stays in SYSTEM.
  if funded and decided_verdict='CORRECT' then
    select id into creator_account from public.energy_accounts
      where user_id=round_row.initiator_id for update;
    if creator_account is null then raise exception 'creator energy account not found'; end if;
    creator_payout := 2.000000;
    update public.energy_accounts set balance=balance+creator_payout where id=creator_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,creator_account,creator_payout);
    total_payout := total_payout+creator_payout;
  end if;

  if total_payout<>0 then
    update public.energy_accounts set balance=balance-total_payout where id=system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,system_account,-total_payout);
  end if;

  verdict_event := jsonb_build_object(
    'id','vote-verdict:'||round_row.id::text,
    'type','KnowledgeVerdictFinalized','scope','public','schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object(
      'roundId',round_row.id::text,'nodeId',round_row.node_id,
      'verdict',decided_verdict,'closeReason',decided_reason,
      'agreeCount',agree_count,'disagreeCount',disagree_count,
      'requiredVotes',round_row.required_votes,'policyVersion',round_row.policy_version
    )
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(verdict_event->>'id',1,'KnowledgeVerdictFinalized',verdict_event,trigger_actor)
  on conflict(event_id) do nothing;

  update public.knowledge_pending_vote_rounds set
    verdict=decided_verdict,close_reason=decided_reason,closed_at=clock_timestamp(),
    final_agree_count=agree_count,final_disagree_count=disagree_count,
    settlement_transaction_id=tx
  where id=round_row.id;

  perform public.assert_energy_conservation();
  return jsonb_build_object('verdict',decided_verdict,'close_reason',decided_reason,
    'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
end $$;

create or replace function public.pending_vote_snapshot(target_node_id text) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  round_row public.knowledge_pending_vote_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  my_side text;
  my_vote_status text;
  my_balance numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into round_row from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and round_no=1;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count from public.knowledge_pending_votes
    where round_id=round_row.id and settlement_status='ACTIVE';
  select side,settlement_status into my_side,my_vote_status from public.knowledge_pending_votes
    where round_id=round_row.id and voter_id=actor;
  select balance into my_balance from public.energy_accounts where user_id=actor;
  return jsonb_build_object(
    'node_id',target_node_id,'round_id',round_row.id::text,
    'agree_count',agree_count,'disagree_count',disagree_count,
    'required_votes',round_row.required_votes,'my_side',my_side,'my_vote_status',my_vote_status,
    'my_balance',case when my_balance is null then null else my_balance::text end,
    'verdict',round_row.verdict,'close_reason',round_row.close_reason,
    'deadline',round_row.deadline,'closed_at',round_row.closed_at,
    'policy_version',round_row.policy_version
  );
end $$;

create or replace function public.cast_pending_knowledge_vote(
  target_node_id text,
  vote_side text,
  operation_key text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  user_account uuid;
  tx uuid;
  prior record;
  existing_side text;
  stake_amount numeric(30,6) := 1.000000;
  request_hash text;
  vote_round_id uuid;
  round_verdict text;
  round_initiator uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if vote_side not in ('AGREE','DISAGREE') then raise exception 'invalid vote side' using errcode='22023'; end if;
  if nullif(target_node_id,'') is null or nullif(operation_key,'') is null then
    raise exception 'node id and idempotency key required' using errcode='22023';
  end if;

  perform public.ensure_anonymous_profile();
  perform pg_advisory_xact_lock(hashtextextended('pending-vote:'||target_node_id,0));
  vote_round_id := public.pending_vote_round_for_node(target_node_id);
  perform public.finalize_pending_vote_round(vote_round_id);
  select verdict,initiator_id into round_verdict,round_initiator
    from public.knowledge_pending_vote_rounds where id=vote_round_id;
  if round_verdict<>'PENDING' then return public.pending_vote_snapshot(target_node_id); end if;
  if round_initiator=actor then
    raise exception 'claim creator cannot cast an ordinary vote on the same first-round claim' using errcode='42501';
  end if;

  select side into existing_side from public.knowledge_pending_votes
    where knowledge_pending_votes.round_id=vote_round_id and voter_id=actor;
  if found then
    if existing_side<>vote_side then raise exception 'vote already cast for this node' using errcode='23505'; end if;
    return public.pending_vote_snapshot(target_node_id);
  end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'node_id',target_node_id,'round_id',vote_round_id::text,'side',vote_side,'stake',stake_amount::text
  )::text,'UTF8')),'hex');
  select id,energy_transactions.request_hash into prior from public.energy_transactions
    where actor_id=actor and transaction_type='VOTE_STAKE' and idempotency_key=operation_key;
  if found then
    if prior.request_hash<>request_hash then raise exception 'idempotency key parameter mismatch' using errcode='22023'; end if;
    raise exception 'vote transaction exists without vote record' using errcode='XX000';
  end if;

  select id into user_account from public.energy_accounts where user_id=actor for update;
  if user_account is null then raise exception 'energy account not found'; end if;
  update public.energy_accounts set balance=balance-stake_amount
    where id=user_account and balance-stake_amount>=-10.000000;
  if not found then raise exception 'insufficient energy' using errcode='23514'; end if;

  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_STAKE',operation_key,
    jsonb_build_object('operation','PENDING_VOTE','node_id',target_node_id,
      'round_id',vote_round_id::text,'side',vote_side,'stake',stake_amount::text),
    actor,request_hash)
  returning id into tx;
  insert into public.energy_ledger_entries(transaction_id,account_id,amount) values
    (tx,user_account,-stake_amount),
    (tx,'00000000-0000-0000-0000-000000000001',stake_amount);
  update public.energy_accounts set balance=balance+stake_amount where account_type='SYSTEM';
  insert into public.knowledge_pending_votes(node_id,round_id,voter_id,side,stake,transaction_id)
    values(target_node_id,vote_round_id,actor,vote_side,stake_amount,tx);

  perform public.finalize_pending_vote_round(vote_round_id);
  perform public.assert_energy_conservation();
  return public.pending_vote_snapshot(target_node_id);
end $$;

create or replace function public.settle_expired_pending_knowledge_votes(max_rounds integer default 50) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare item record; processed integer := 0; final_verdict text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if max_rounds<1 or max_rounds>200 then raise exception 'invalid max_rounds' using errcode='22023'; end if;
  for item in
    select r.id from public.knowledge_pending_vote_rounds r
    where r.verdict='PENDING' and (
      r.deadline<=now()
      or (select count(*) from public.knowledge_pending_votes v
          where v.round_id=r.id and v.side='AGREE' and v.settlement_status='ACTIVE')>=r.required_votes
      or (select count(*) from public.knowledge_pending_votes v
          where v.round_id=r.id and v.side='DISAGREE' and v.settlement_status='ACTIVE')>=r.required_votes
    )
    order by r.deadline,r.id limit max_rounds
  loop
    perform public.finalize_pending_vote_round(item.id);
    select verdict into final_verdict from public.knowledge_pending_vote_rounds where id=item.id;
    if final_verdict<>'PENDING' then processed:=processed+1; end if;
  end loop;
  return processed;
end $$;

revoke all on function public.pending_vote_round_for_node(text),
  public.fund_new_pending_vote_round(text,uuid,timestamptz,text),
  public.finalize_pending_vote_round(uuid),public.pending_vote_snapshot(text)
from public,anon,authenticated;
revoke all on function public.get_pending_knowledge_vote(text),
  public.cast_pending_knowledge_vote(text,text,text),
  public.settle_expired_pending_knowledge_votes(integer)
from public,anon,authenticated;
grant execute on function public.get_pending_knowledge_vote(text),
  public.cast_pending_knowledge_vote(text,text,text),
  public.settle_expired_pending_knowledge_votes(integer)
to authenticated;

-- Repair old unresolved rounds only after V2 and invalid-ballot refund semantics
-- are installed. Threshold-ready rounds close by historical chronology; rounds
-- that have not reached threshold and are younger than 720 hours remain pending.
do $$
declare item record;
begin
  for item in
    select id from public.knowledge_pending_vote_rounds
    where verdict='PENDING' and legacy_unfunded
    order by opened_at,id
  loop
    perform public.finalize_pending_vote_round(item.id);
  end loop;
end $$;

comment on column public.knowledge_pending_votes.settlement_status is
  'ACTIVE participates in verdict/reward math; VOID_LATE and VOID_CREATOR preserve impossible historical ballots and refund their exact stake.';
comment on function public.settle_expired_pending_knowledge_votes(integer) is
  'ORIGINAL_DESIGN_V2 readiness sweep: threshold wins close immediately; unresolved 720-hour rounds fail for insufficient support.';
comment on table public.knowledge_pending_vote_rounds is
  'Versioned first-round adjudication. Hosted rollout begins with ORIGINAL_DESIGN_V2; V1 remains a replayable historical policy identifier.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180004'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
