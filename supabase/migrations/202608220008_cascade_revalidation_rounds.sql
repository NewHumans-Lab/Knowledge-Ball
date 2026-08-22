-- Knowledge Lineage V3 convergence / part 2.
-- Restore the original cascade contract after a current-premise version changes:
-- descendants enter a real PENDING verification round, with no human initiator,
-- no initiator stake/vote, ordinary one-energy votes, and a 720-hour tie that
-- remains PENDING. Human ORIGINAL_DESIGN_V1 revalidation is not modified here.

alter table public.knowledge_pending_vote_rounds
  add column if not exists round_kind text not null default 'INITIAL';
alter table public.knowledge_pending_vote_rounds
  add column if not exists source_node_id text;
alter table public.knowledge_pending_vote_rounds
  add column if not exists source_event_id text;

alter table public.knowledge_pending_vote_rounds
  drop constraint if exists knowledge_pending_vote_rounds_round_kind_check;
alter table public.knowledge_pending_vote_rounds
  add constraint knowledge_pending_vote_rounds_round_kind_check
  check (round_kind in ('INITIAL','CASCADE'));

alter table public.knowledge_pending_vote_rounds alter column initiator_id drop not null;
alter table public.knowledge_pending_vote_rounds alter column initiator_side drop not null;
alter table public.knowledge_pending_vote_rounds
  drop constraint if exists knowledge_pending_vote_rounds_initiator_side_check;
alter table public.knowledge_pending_vote_rounds
  add constraint knowledge_pending_vote_rounds_initiator_side_check
  check (initiator_side is null or initiator_side in ('AGREE','DISAGREE'));

alter table public.knowledge_pending_votes
  drop constraint if exists knowledge_pending_votes_node_id_voter_id_key;
alter table public.knowledge_pending_votes
  drop constraint if exists knowledge_pending_votes_round_id_voter_id_key;
alter table public.knowledge_pending_votes
  add constraint knowledge_pending_votes_round_id_voter_id_key unique(round_id,voter_id);

create unique index if not exists knowledge_pending_one_open_round_per_node
  on public.knowledge_pending_vote_rounds(node_id)
  where verdict='PENDING';
create index if not exists knowledge_pending_rounds_kind
  on public.knowledge_pending_vote_rounds(round_kind,node_id,round_no);

create or replace function public.latest_pending_vote_round(target_node_id text) returns uuid
language sql stable security definer
set search_path=public,pg_temp
as $$
  select id
  from public.knowledge_pending_vote_rounds
  where node_id=target_node_id and verdict='PENDING'
  order by round_no desc,id desc
  limit 1
$$;
revoke all on function public.latest_pending_vote_round(text) from public,anon;
grant execute on function public.latest_pending_vote_round(text) to authenticated;

create or replace function public.pending_vote_snapshot(target_node_id text) returns jsonb
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid:=auth.uid();
  round_row public.knowledge_pending_vote_rounds%rowtype;
  agree_count integer;
  disagree_count integer;
  my_side text;
  my_vote_status text;
  my_balance numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into round_row
  from public.knowledge_pending_vote_rounds
  where node_id=target_node_id
  order by (verdict='PENDING') desc,round_no desc,id desc
  limit 1;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';
  select side,settlement_status into my_side,my_vote_status
  from public.knowledge_pending_votes
  where round_id=round_row.id and voter_id=actor;
  select balance into my_balance from public.energy_accounts where user_id=actor;

  return jsonb_build_object(
    'node_id',target_node_id,'round_id',round_row.id::text,'round_no',round_row.round_no,
    'round_kind',round_row.round_kind,
    'source_node_id',round_row.source_node_id,'source_event_id',round_row.source_event_id,
    'agree_count',agree_count,'disagree_count',disagree_count,'required_votes',round_row.required_votes,
    'my_side',my_side,'my_vote_status',my_vote_status,
    'my_balance',case when my_balance is null then null else my_balance::text end,
    'verdict',round_row.verdict,'close_reason',round_row.close_reason,
    'deadline',round_row.deadline,'closed_at',round_row.closed_at,'policy_version',round_row.policy_version
  );
end $$;

-- Finalization keeps ORIGINAL_DESIGN_V2 initial rounds byte-for-byte equivalent
-- in semantics. Only CASCADE timeout differs: after 720h an exact ordinary-vote
-- tie remains PENDING and later ordinary votes may break that tie.
create or replace function public.finalize_pending_vote_round(target_round_id uuid) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  round_row public.knowledge_pending_vote_rounds%rowtype;
  agree_count integer; disagree_count integer;
  agree_threshold_at timestamptz; disagree_threshold_at timestamptz;
  agree_threshold_id uuid; disagree_threshold_id uuid;
  closure_at timestamptz; closure_id uuid;
  decided_verdict text; decided_reason text; winning_side text; funded boolean;
  losing_atoms bigint; winner_count bigint; share_atoms bigint:=0; remainder_atoms bigint:=0; position_index bigint:=0;
  winner record; void_vote record; payout_atoms bigint; payout numeric(30,6);
  total_payout numeric(30,6):=0.000000; creator_payout numeric(30,6):=0.000000;
  creator_account uuid; tx uuid;
  system_account constant uuid:='00000000-0000-0000-0000-000000000001';
  trigger_actor uuid; request_hash text; verdict_event jsonb; status_event jsonb;
begin
  select * into round_row from public.knowledge_pending_vote_rounds where id=target_round_id for update;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;

  if round_row.verdict<>'PENDING' then
    select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
      into agree_count,disagree_count
    from public.knowledge_pending_votes
    where round_id=round_row.id and settlement_status='ACTIVE';
    return jsonb_build_object('verdict',round_row.verdict,'close_reason',round_row.close_reason,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  -- INITIAL has a creator who cannot ordinary-vote. CASCADE has no initiator.
  if round_row.round_kind='INITIAL' and round_row.initiator_id is not null then
    update public.knowledge_pending_votes
    set settlement_status='VOID_CREATOR'
    where round_id=round_row.id and voter_id=round_row.initiator_id and settlement_status='ACTIVE';
  end if;

  -- Initial V2 keeps its fixed 720h vote window. A cascade that reached its
  -- deadline tied remains open, therefore subsequent ordinary votes are valid.
  if round_row.round_kind='INITIAL' then
    update public.knowledge_pending_votes
    set settlement_status='VOID_LATE'
    where round_id=round_row.id and settlement_status='ACTIVE' and created_at>round_row.deadline;
  end if;

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

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
    if disagree_threshold_id is null or (agree_threshold_id is not null and (
      agree_threshold_at<disagree_threshold_at
      or (agree_threshold_at=disagree_threshold_at and agree_threshold_id::text<disagree_threshold_id::text)
    )) then
      decided_verdict:='CORRECT'; closure_at:=agree_threshold_at; closure_id:=agree_threshold_id;
    else
      decided_verdict:='INCORRECT'; closure_at:=disagree_threshold_at; closure_id:=disagree_threshold_id;
    end if;
    decided_reason:='THRESHOLD';
    update public.knowledge_pending_votes
    set settlement_status='VOID_LATE'
    where round_id=round_row.id and settlement_status='ACTIVE' and (
      created_at>closure_at or (created_at=closure_at and id::text>closure_id::text)
    );
  elsif now()>=round_row.deadline then
    if round_row.round_kind='CASCADE' then
      if agree_count=disagree_count then
        return jsonb_build_object('verdict','PENDING','close_reason',null,
          'agree_count',agree_count,'disagree_count',disagree_count,'tied',true);
      end if;
      decided_verdict:=case when agree_count>disagree_count then 'CORRECT' else 'INCORRECT' end;
      decided_reason:='TIMEOUT';
    else
      decided_verdict:='INCORRECT';
      decided_reason:='TIMEOUT';
    end if;
  else
    return jsonb_build_object('verdict','PENDING','close_reason',null,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
  end if;

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  winning_side:=case when decided_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end;
  funded:=round_row.round_kind='INITIAL'
    and not round_row.legacy_unfunded
    and round_row.creator_stake_transaction_id is not null;
  if winning_side='AGREE' then
    losing_atoms:=disagree_count::bigint*1000000;
    winner_count:=agree_count::bigint;
  else
    losing_atoms:=agree_count::bigint*1000000;
    winner_count:=disagree_count::bigint;
  end if;
  if winner_count>0 then
    share_atoms:=losing_atoms/winner_count;
    remainder_atoms:=losing_atoms%winner_count;
  end if;

  trigger_actor:=coalesce(auth.uid(),round_row.initiator_id);
  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'round_id',round_row.id,'round_kind',round_row.round_kind,'verdict',decided_verdict,
    'agree_count',agree_count,'disagree_count',disagree_count,'required_votes',round_row.required_votes,
    'policy_version',round_row.policy_version,
    'timeout_model',case when round_row.round_kind='CASCADE' then 'TIE_STAYS_PENDING' else 'INSUFFICIENT_SUPPORT_FAILS' end,
    'pool_model',case when round_row.round_kind='CASCADE' then 'ORDINARY_ONLY' else 'ORDINARY_PLUS_CREATOR_SYSTEM_WAGER' end,
    'invalid_vote_policy','REFUND'
  )::text,'UTF8')),'hex');

  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_SETTLEMENT','vote-settlement:'||round_row.id::text,
    jsonb_build_object('operation',case when round_row.round_kind='CASCADE' then 'CASCADE_REVALIDATION_SETTLEMENT' else 'PENDING_VOTE_SETTLEMENT' end,
      'round_id',round_row.id,'round_kind',round_row.round_kind,'node_id',round_row.node_id,
      'verdict',decided_verdict,'reason',decided_reason,'policy_version',round_row.policy_version,
      'timeout_model',case when round_row.round_kind='CASCADE' then 'TIE_STAYS_PENDING' else 'INSUFFICIENT_SUPPORT_FAILS' end,
      'pool_model',case when round_row.round_kind='CASCADE' then 'ORDINARY_ONLY' else 'ORDINARY_PLUS_CREATOR_SYSTEM_WAGER' end,
      'invalid_vote_policy','REFUND'),trigger_actor,request_hash)
  returning id into tx;

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
    total_payout:=total_payout+void_vote.stake;
  end loop;

  if winner_count>0 then
    for winner in
      select 'vote:'||v.id::text as position_key,a.id as account_id
      from public.knowledge_pending_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=round_row.id and v.side=winning_side and v.settlement_status='ACTIVE'
      order by position_key
    loop
      position_index:=position_index+1;
      payout_atoms:=1000000+share_atoms+case when position_index<=remainder_atoms then 1 else 0 end;
      payout:=(payout_atoms::numeric/1000000)::numeric(30,6);
      update public.energy_accounts set balance=balance+payout where id=winner.account_id;
      insert into public.energy_ledger_entries(transaction_id,account_id,amount)
        values(tx,winner.account_id,payout);
      total_payout:=total_payout+payout;
    end loop;
  end if;

  if funded and decided_verdict='CORRECT' then
    select id into creator_account from public.energy_accounts where user_id=round_row.initiator_id for update;
    if creator_account is null then raise exception 'creator energy account not found'; end if;
    creator_payout:=2.000000;
    update public.energy_accounts set balance=balance+creator_payout where id=creator_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,creator_account,creator_payout);
    total_payout:=total_payout+creator_payout;
  end if;

  if total_payout<>0 then
    update public.energy_accounts set balance=balance-total_payout where id=system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,system_account,-total_payout);
  end if;

  verdict_event:=jsonb_build_object(
    'id','vote-verdict:'||round_row.id::text,'type','KnowledgeVerdictFinalized','scope','public','schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object(
      'roundId',round_row.id::text,'nodeId',round_row.node_id,'verdict',decided_verdict,
      'closeReason',decided_reason,'agreeCount',agree_count,'disagreeCount',disagree_count,
      'requiredVotes',round_row.required_votes,'policyVersion',round_row.policy_version
    )
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(verdict_event->>'id',1,'KnowledgeVerdictFinalized',verdict_event,trigger_actor)
  on conflict(event_id) do nothing;

  if round_row.round_kind='CASCADE' then
    status_event:=jsonb_build_object(
      'id','cascade-result:'||round_row.id::text,'type','KnowledgeStatusChanged','scope','public','schemaVersion',1,
      'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
      'payload',jsonb_build_object('edit',jsonb_build_object(
        'kind','status','nodeId',round_row.node_id,
        'status',case when decided_verdict='CORRECT' then 'verified' else 'suspended' end,
        'causeNodeId',round_row.source_node_id
      ))
    );
    insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
    values(status_event->>'id',1,'KnowledgeStatusChanged',status_event,trigger_actor)
    on conflict(event_id) do nothing;
  end if;

  update public.knowledge_pending_vote_rounds set
    verdict=decided_verdict,close_reason=decided_reason,closed_at=clock_timestamp(),
    final_agree_count=agree_count,final_disagree_count=disagree_count,settlement_transaction_id=tx
  where id=round_row.id;

  perform public.assert_energy_conservation();
  return jsonb_build_object('verdict',decided_verdict,'close_reason',decided_reason,
    'agree_count',agree_count,'disagree_count',disagree_count,'tied',false);
end $$;

create or replace function public.get_pending_knowledge_vote(target_node_id text) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare round_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  round_id:=public.latest_pending_vote_round(target_node_id);
  if round_id is null then round_id:=public.pending_vote_round_for_node(target_node_id); end if;
  perform public.finalize_pending_vote_round(round_id);
  return public.pending_vote_snapshot(target_node_id);
end $$;

create or replace function public.cast_pending_knowledge_vote(target_node_id text,vote_side text,operation_key text) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  actor uuid:=auth.uid(); user_account uuid; tx uuid; prior record; existing_side text;
  stake_amount numeric(30,6):=1.000000; request_hash text; vote_round_id uuid;
  round_row public.knowledge_pending_vote_rounds%rowtype;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if vote_side not in ('AGREE','DISAGREE') then raise exception 'invalid vote side' using errcode='22023'; end if;
  if nullif(target_node_id,'') is null or nullif(operation_key,'') is null then
    raise exception 'node id and idempotency key required' using errcode='22023';
  end if;
  perform public.ensure_anonymous_profile();
  perform pg_advisory_xact_lock(hashtextextended('pending-vote:'||target_node_id,0));
  vote_round_id:=public.latest_pending_vote_round(target_node_id);
  if vote_round_id is null then vote_round_id:=public.pending_vote_round_for_node(target_node_id); end if;
  perform public.finalize_pending_vote_round(vote_round_id);
  select * into round_row from public.knowledge_pending_vote_rounds where id=vote_round_id;
  if round_row.verdict<>'PENDING' then return public.pending_vote_snapshot(target_node_id); end if;

  if round_row.round_kind='INITIAL' and round_row.initiator_id=actor then
    raise exception 'claim creator cannot cast an ordinary vote on the same first-round claim' using errcode='42501';
  end if;
  select side into existing_side from public.knowledge_pending_votes
    where round_id=vote_round_id and voter_id=actor;
  if found then
    if existing_side<>vote_side then raise exception 'vote already cast for this round' using errcode='23505'; end if;
    return public.pending_vote_snapshot(target_node_id);
  end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
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
  values('VOTE_STAKE',operation_key,jsonb_build_object('operation','PENDING_VOTE','node_id',target_node_id,
    'round_id',vote_round_id::text,'round_kind',round_row.round_kind,'side',vote_side,'stake',stake_amount::text),actor,request_hash)
  returning id into tx;
  insert into public.energy_ledger_entries(transaction_id,account_id,amount) values
    (tx,user_account,-stake_amount),(tx,'00000000-0000-0000-0000-000000000001',stake_amount);
  update public.energy_accounts set balance=balance+stake_amount where account_type='SYSTEM';
  insert into public.knowledge_pending_votes(node_id,round_id,voter_id,side,stake,transaction_id)
    values(target_node_id,vote_round_id,actor,vote_side,stake_amount,tx);
  perform public.finalize_pending_vote_round(vote_round_id);
  perform public.assert_energy_conservation();
  return public.pending_vote_snapshot(target_node_id);
end $$;

-- Server-only helper: an automatic cascade has no user initiator and no creator
-- wager. It uses the existing ordinary one-energy pending-vote pool.
create or replace function private.start_cascade_knowledge_revalidation(
  target_node_id text,
  source_node_id text,
  triggering_event_id text,
  triggering_actor uuid
) returns boolean
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare
  next_round integer;
  snapshot bigint;
  opened timestamptz:=clock_timestamp();
  event_envelope jsonb;
begin
  if nullif(target_node_id,'') is null or nullif(source_node_id,'') is null
     or nullif(triggering_event_id,'') is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('cascade-verification:'||target_node_id,0));
  if exists (
    select 1 from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and verdict='PENDING'
  ) then return false; end if;

  select coalesce(max(round_no),0)+1 into next_round
  from public.knowledge_pending_vote_rounds where node_id=target_node_id;
  select greatest(count(*),1)::bigint into snapshot
  from public.knowledge_ball_profiles where active;

  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,
    creator_stake_transaction_id,legacy_unfunded,round_kind,source_node_id,source_event_id
  ) values(
    target_node_id,next_round,'ORIGINAL_DESIGN_V1',null,null,
    snapshot,public.pending_vote_required_for_snapshot(snapshot),opened,opened+interval '720 hours',
    null,true,'CASCADE',source_node_id,triggering_event_id
  );

  event_envelope:=jsonb_build_object(
    'id','cascade-revalidation:'||triggering_event_id||':'||target_node_id,
    'type','KnowledgeStatusChanged','scope','public','schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object('edit',jsonb_build_object(
      'kind','status','nodeId',target_node_id,'status','pending','causeNodeId',source_node_id
    ))
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(event_envelope->>'id',1,'KnowledgeStatusChanged',event_envelope,triggering_actor)
  on conflict(event_id) do nothing;
  return true;
end $$;
revoke all on function private.start_cascade_knowledge_revalidation(text,text,text,uuid)
from public,anon,authenticated;

-- Supersede module 6's reduced "disputed only" implementation while preserving
-- the already-tested current-only recursive traversal and effective-edge repoint.
create or replace function private.emit_downstream_revalidation(
  old_current_id text,
  new_current_id text,
  triggering_event_id text,
  triggering_actor uuid
) returns integer
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare target_id text; emitted integer:=0; started boolean;
begin
  if nullif(old_current_id,'') is null or nullif(new_current_id,'') is null
     or nullif(triggering_event_id,'') is null then return 0; end if;

  for target_id in
    with recursive downstream(node_id) as (
      select e.conclusion_node_id
      from private.knowledge_dependency_edges e
      join private.knowledge_lineage_members lm
        on lm.node_id=e.conclusion_node_id and lm.role='current'
      where e.premise_node_id=old_current_id
      union
      select e.conclusion_node_id
      from private.knowledge_dependency_edges e
      join downstream d on e.premise_node_id=d.node_id
      join private.knowledge_lineage_members lm
        on lm.node_id=e.conclusion_node_id and lm.role='current'
    )
    select node_id from downstream where node_id<>new_current_id order by node_id
  loop
    started:=private.start_cascade_knowledge_revalidation(
      target_id,old_current_id,triggering_event_id,triggering_actor
    );
    if started then emitted:=emitted+1; end if;
  end loop;

  perform private.repoint_dependency_sources(array[old_current_id],new_current_id);
  return emitted;
end $$;
revoke all on function private.emit_downstream_revalidation(text,text,text,uuid)
from public,anon,authenticated;

-- Cascade verdicts are ordinary support rechecks, not another current-head
-- transition. Prevent module 6 and module 5 from interpreting them as a second
-- optimization/opposition promotion or viewpoint flip.
create or replace function private.cascade_on_current_version_change() returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare changed_node_id text; old_current_id text; proposal_kind text; round_id uuid; role_at_start_value text;
begin
  if new.event_type='KnowledgeVerdictFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    if new.envelope#>>'{payload,policyVersion}'='ORIGINAL_DESIGN_V1' then return new; end if;
    changed_node_id:=new.envelope#>>'{payload,nodeId}';
    select proposal,target_id into proposal_kind,old_current_id
    from private.knowledge_lineage_members where node_id=changed_node_id and role='current';
    if proposal_kind in('optimization','opposition') and old_current_id is not null then
      perform private.emit_downstream_revalidation(old_current_id,changed_node_id,new.event_id,new.actor_id);
    end if;
    return new;
  end if;
  if new.event_type='KnowledgeRevalidationFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    changed_node_id:=new.envelope#>>'{payload,nodeId}';
    round_id:=(new.envelope#>>'{payload,roundId}')::uuid;
    select role_at_start into role_at_start_value
    from private.knowledge_revalidation_rounds where id=round_id;
    if role_at_start_value='history' then
      select node_id into old_current_id from private.knowledge_lineage_members
      where topic_id=new.envelope#>>'{payload,topicId}' and role='history' and rank=1;
    elsif role_at_start_value='opposition' then
      select node_id into old_current_id from private.knowledge_lineage_members
      where topic_id=new.envelope#>>'{payload,topicId}' and role='opposition' and rank=1;
    end if;
    if old_current_id is not null then
      perform private.emit_downstream_revalidation(old_current_id,changed_node_id,new.event_id,new.actor_id);
    end if;
    return new;
  end if;
  return new;
end $$;

create or replace function private.reconcile_knowledge_viewpoint_event() returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare v_node_id text; v_topic_id text; v_proposal text; v_role_at_start text; v_round_id uuid;
begin
  if new.event_type='KnowledgeVerdictFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    if new.envelope#>>'{payload,policyVersion}'='ORIGINAL_DESIGN_V1' then return new; end if;
    v_node_id:=new.envelope#>>'{payload,nodeId}';
    select m.topic_id,m.proposal into v_topic_id,v_proposal
    from private.knowledge_lineage_members m where m.node_id=v_node_id and m.role='current';
    if v_proposal='opposition' then
      perform private.reconcile_knowledge_viewpoint(v_topic_id,new.event_id,new.event_type,new.actor_id);
    end if;
    return new;
  end if;
  if new.event_type='KnowledgeRevalidationFinalized'
     and new.envelope#>>'{payload,verdict}'='CORRECT' then
    v_round_id:=(new.envelope#>>'{payload,roundId}')::uuid;
    select rr.topic_id,rr.role_at_start into v_topic_id,v_role_at_start
    from private.knowledge_revalidation_rounds rr where rr.id=v_round_id;
    if v_role_at_start='opposition' then
      perform private.reconcile_knowledge_viewpoint(v_topic_id,new.event_id,new.event_type,new.actor_id);
    end if;
    return new;
  end if;
  return new;
end $$;

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path=public,pg_temp
as $$ select '202608220008'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
