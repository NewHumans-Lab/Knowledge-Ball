-- Keep ORIGINAL_DESIGN_V1's two economic channels distinct:
-- 1) ordinary winning voters split only ordinary losing-voter stakes;
-- 2) the creator's 1-energy position is a separate creator-vs-system wager.
-- Also preserve historical first-to-threshold ordering when backfilled votes have
-- accumulated on both sides before this adjudication engine existed.

create or replace function public.finalize_pending_vote_round(target_round_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  round_row public.knowledge_pending_vote_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  agree_threshold record;
  disagree_threshold record;
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

  select count(*) filter(where side='AGREE'), count(*) filter(where side='DISAGREE')
    into agree_count, disagree_count
  from public.knowledge_pending_votes where round_id=round_row.id;

  if round_row.verdict <> 'PENDING' then
    return jsonb_build_object('verdict',round_row.verdict,'close_reason',round_row.close_reason,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  -- The live path finalizes immediately after every serialized vote, but legacy
  -- rows may already contain both sides above the old threshold. Reconstruct the
  -- exact vote that first reached each side's snapshotted threshold.
  select created_at,id into agree_threshold
  from public.knowledge_pending_votes
  where round_id=round_row.id and side='AGREE'
  order by created_at,id
  offset greatest(round_row.required_votes-1,0) limit 1;

  select created_at,id into disagree_threshold
  from public.knowledge_pending_votes
  where round_id=round_row.id and side='DISAGREE'
  order by created_at,id
  offset greatest(round_row.required_votes-1,0) limit 1;

  if agree_threshold.id is not null or disagree_threshold.id is not null then
    if disagree_threshold.id is null
       or (agree_threshold.id is not null and (
         agree_threshold.created_at < disagree_threshold.created_at
         or (agree_threshold.created_at = disagree_threshold.created_at
             and agree_threshold.id::text < disagree_threshold.id::text)
       )) then
      decided_verdict := 'CORRECT';
    else
      decided_verdict := 'INCORRECT';
    end if;
    decided_reason := 'THRESHOLD';
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

  winning_side := case when decided_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end;
  funded := not round_row.legacy_unfunded and round_row.creator_stake_transaction_id is not null;

  -- Ordinary ballot settlement is its own zero-sum pool. Each winning voter gets
  -- their 1-energy stake back plus an equal largest-remainder share of only the
  -- losing ordinary voter stakes.
  if winning_side='AGREE' then
    losing_atoms := disagree_count::bigint * 1000000;
    winner_count := agree_count::bigint;
  else
    losing_atoms := agree_count::bigint * 1000000;
    winner_count := disagree_count::bigint;
  end if;
  if winner_count > 0 then
    share_atoms := losing_atoms / winner_count;
    remainder_atoms := losing_atoms % winner_count;
  end if;

  trigger_actor := coalesce(auth.uid(),round_row.initiator_id);
  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'round_id',round_row.id,'verdict',decided_verdict,'agree_count',agree_count,
    'disagree_count',disagree_count,'required_votes',round_row.required_votes,
    'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER'
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_SETTLEMENT','vote-settlement:'||round_row.id::text,
    jsonb_build_object('operation','PENDING_VOTE_SETTLEMENT','round_id',round_row.id,
      'node_id',round_row.node_id,'verdict',decided_verdict,'reason',decided_reason,
      'pool_model','ORDINARY_PLUS_CREATOR_SYSTEM_WAGER'),
    trigger_actor,request_hash)
  returning id into tx;

  if winner_count > 0 then
    for winner in
      select 'vote:'||v.id::text as position_key,a.id as account_id
      from public.knowledge_pending_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=round_row.id and v.side=winning_side
      order by position_key
    loop
      position_index := position_index + 1;
      payout_atoms := 1000000 + share_atoms
        + case when position_index <= remainder_atoms then 1 else 0 end;
      payout := (payout_atoms::numeric/1000000)::numeric(30,6);
      update public.energy_accounts set balance=balance+payout where id=winner.account_id;
      insert into public.energy_ledger_entries(transaction_id,account_id,amount)
        values(tx,winner.account_id,payout);
      total_payout := total_payout+payout;
    end loop;
  end if;

  -- Creator/system wager is separate from the voter pool. The creator already
  -- locked 1 energy at claim creation. CORRECT returns that 1 and pays +1 from
  -- the system; INCORRECT pays nothing and the system retains the creator stake.
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

  if total_payout <> 0 then
    update public.energy_accounts set balance=balance-total_payout where id=system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,system_account,-total_payout);
  end if;

  verdict_event := jsonb_build_object(
    'id','vote-verdict:'||round_row.id::text,
    'type','KnowledgeVerdictFinalized',
    'scope','public',
    'schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object(
      'roundId',round_row.id::text,
      'nodeId',round_row.node_id,
      'verdict',decided_verdict,
      'closeReason',decided_reason,
      'agreeCount',agree_count,
      'disagreeCount',disagree_count,
      'requiredVotes',round_row.required_votes,
      'policyVersion',round_row.policy_version
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

revoke all on function public.finalize_pending_vote_round(uuid) from public,anon,authenticated;
comment on function public.finalize_pending_vote_round(uuid) is
  'Internal idempotent ORIGINAL_DESIGN_V1 settlement. Ordinary voter pool and creator/system wager are intentionally separate.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
