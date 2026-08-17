-- Historical compatibility for the period where pending rounds did not close.
-- Any ballot recorded after the first side had already reached the snapshotted
-- threshold could not have existed in a correct implementation. Keep it for
-- audit, exclude it from verdict/reward math, and refund its exact 1-energy stake.

alter table public.knowledge_pending_votes
  add column settlement_status text not null default 'ACTIVE'
    check (settlement_status in ('ACTIVE','VOID_LATE')),
  add column refunded_transaction_id uuid references public.energy_transactions(id);
create index knowledge_pending_votes_active_round_side
  on public.knowledge_pending_votes(round_id,side,created_at,id)
  where settlement_status='ACTIVE';

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
  late_vote record;
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

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  if round_row.verdict <> 'PENDING' then
    return jsonb_build_object('verdict',round_row.verdict,'close_reason',round_row.close_reason,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

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
         agree_threshold_at < disagree_threshold_at
         or (agree_threshold_at = disagree_threshold_at and agree_threshold_id::text < disagree_threshold_id::text)
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

    -- Rows after the exact threshold-closing ballot are historical late ballots.
    update public.knowledge_pending_votes
    set settlement_status='VOID_LATE'
    where round_id=round_row.id and settlement_status='ACTIVE' and (
      created_at > closure_at or (created_at=closure_at and id::text > closure_id::text)
    );
  elsif now() >= round_row.deadline then
    if agree_count + case when round_row.initiator_side='AGREE' then 1 else 0 end
       = disagree_count + case when round_row.initiator_side='DISAGREE' then 1 else 0 end then
      return jsonb_build_object('verdict','PENDING','close_reason',null,
        'agree_count',agree_count,'disagree_count',disagree_count,'tied',true);
    end if;
    decided_verdict := case when
      agree_count + case when round_row.initiator_side='AGREE' then 1 else 0 end >
      disagree_count + case when round_row.initiator_side='DISAGREE' then 1 else 0 end
      then 'CORRECT' else 'INCORRECT' end;
    decided_reason := 'TIMEOUT';
  else
    return jsonb_build_object('verdict','PENDING','close_reason',null,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  -- Recount after historical late ballots have been excluded.
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  winning_side := case when decided_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end;
  funded := not round_row.legacy_unfunded and round_row.creator_stake_transaction_id is not null;
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
    'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER','late_vote_policy','REFUND'
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_SETTLEMENT','vote-settlement:'||round_row.id::text,
    jsonb_build_object('operation','PENDING_VOTE_SETTLEMENT','round_id',round_row.id,
      'node_id',round_row.node_id,'verdict',decided_verdict,'reason',decided_reason,
      'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER','late_vote_policy','REFUND'),
    trigger_actor,request_hash)
  returning id into tx;

  -- Exact refund for historical ballots that should have been rejected because
  -- the round had already closed. They never participate as winners or losers.
  for late_vote in
    select v.id,a.id as account_id
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=round_row.id and v.settlement_status='VOID_LATE'
      and v.refunded_transaction_id is null
    order by v.created_at,v.id
  loop
    update public.energy_accounts set balance=balance+1.000000 where id=late_vote.account_id;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,late_vote.account_id,1.000000);
    update public.knowledge_pending_votes set refunded_transaction_id=tx where id=late_vote.id;
    total_payout := total_payout+1.000000;
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
      or (select count(*) from public.knowledge_pending_votes v where v.round_id=r.id and v.side='AGREE' and v.settlement_status='ACTIVE')>=r.required_votes
      or (select count(*) from public.knowledge_pending_votes v where v.round_id=r.id and v.side='DISAGREE' and v.settlement_status='ACTIVE')>=r.required_votes
    )
    order by r.deadline,r.id limit max_rounds
  loop
    perform public.finalize_pending_vote_round(item.id);
    select verdict into final_verdict from public.knowledge_pending_vote_rounds where id=item.id;
    if final_verdict<>'PENDING' then processed:=processed+1; end if;
  end loop;
  return processed;
end $$;

revoke all on function public.finalize_pending_vote_round(uuid),
  public.pending_vote_snapshot(text),public.settle_expired_pending_knowledge_votes(integer)
from public,anon,authenticated;
grant execute on function public.settle_expired_pending_knowledge_votes(integer) to authenticated;

-- Now that late ballots can be identified and refunded safely, repair every old
-- unresolved round. Non-ready/non-expired rounds simply remain PENDING.
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
  'ACTIVE votes participate in verdict/reward math; VOID_LATE preserves and refunds historical ballots accepted after closure.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180004'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
