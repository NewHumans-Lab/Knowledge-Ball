-- Complete ORIGINAL_DESIGN_V1 initial pending-node adjudication.
-- This forward migration adds snapshotted voting rounds, atomic threshold/timeout
-- finalization, conserved-energy settlement, server-authored verdict events, and
-- compatibility backfill for votes already recorded by 202608170001.

alter table public.energy_transactions drop constraint if exists energy_transactions_transaction_type_check;
alter table public.energy_transactions add constraint energy_transactions_transaction_type_check
  check (transaction_type in ('REFERRAL', 'SPEND', 'TRANSFER', 'VOTE_STAKE', 'CLAIM_STAKE', 'VOTE_SETTLEMENT'));

alter table public.public_knowledge_events drop constraint if exists public_knowledge_events_event_type_check;
alter table public.public_knowledge_events add constraint public_knowledge_events_event_type_check
  check (event_type in ('NodeCreated','NodeEdited','NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved',
    'KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged',
    'KnowledgeNodeEdited','KnowledgeVerdictFinalized'));

create table public.knowledge_pending_vote_rounds (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  round_no integer not null default 1 check (round_no > 0),
  policy_version text not null default 'ORIGINAL_DESIGN_V1'
    check (policy_version = 'ORIGINAL_DESIGN_V1'),
  initiator_id uuid not null references auth.users(id),
  initiator_side text not null default 'AGREE' check (initiator_side in ('AGREE','DISAGREE')),
  eligible_user_snapshot bigint not null check (eligible_user_snapshot >= 0),
  required_votes integer not null check (required_votes > 0),
  opened_at timestamptz not null,
  deadline timestamptz not null,
  verdict text not null default 'PENDING' check (verdict in ('PENDING','CORRECT','INCORRECT')),
  close_reason text check (close_reason is null or close_reason in ('THRESHOLD','TIMEOUT')),
  closed_at timestamptz,
  final_agree_count integer check (final_agree_count is null or final_agree_count >= 0),
  final_disagree_count integer check (final_disagree_count is null or final_disagree_count >= 0),
  creator_stake_transaction_id uuid unique references public.energy_transactions(id),
  settlement_transaction_id uuid unique references public.energy_transactions(id),
  legacy_unfunded boolean not null default false,
  unique(node_id, round_no),
  check (deadline = opened_at + interval '720 hours'),
  check ((verdict = 'PENDING' and closed_at is null and close_reason is null)
      or (verdict <> 'PENDING' and closed_at is not null and close_reason is not null))
);
create index knowledge_pending_vote_rounds_open_deadline
  on public.knowledge_pending_vote_rounds(deadline, node_id) where verdict = 'PENDING';
alter table public.knowledge_pending_vote_rounds enable row level security;
revoke all on public.knowledge_pending_vote_rounds from public, anon, authenticated;

create or replace function public.pending_vote_required_for_snapshot(user_snapshot bigint) returns integer
language plpgsql immutable strict set search_path = public, pg_temp as $$
declare required integer := 1; tier bigint := 10;
begin
  if user_snapshot < 0 then raise exception 'user snapshot must be non-negative' using errcode = '22023'; end if;
  while greatest(user_snapshot, 1) >= tier loop
    required := required * 2;
    if tier > 100000000000000000 then exit; end if;
    tier := tier * 10;
  end loop;
  return required;
end $$;

-- Freeze all pre-migration pending nodes into legacy rounds without charging a
-- retroactive creator stake. Existing creators must not suddenly lose energy.
with all_births as (
  select sequence, actor_id, created_at, envelope#>>'{payload,edit,node,id}' as node_id
    from public.public_knowledge_events where event_type = 'KnowledgeAdded'
  union all
  select sequence, actor_id, created_at, envelope#>>'{payload,edit,reasoning,id}'
    from public.public_knowledge_events where event_type = 'KnowledgeAdded'
  union all
  select sequence, actor_id, created_at, envelope#>>'{payload,edit,conclusion,id}'
    from public.public_knowledge_events where event_type = 'KnowledgeAdded'
  union all
  select sequence, actor_id, created_at, envelope#>>'{payload,nodeId}'
    from public.public_knowledge_events where event_type = 'NodeCreated'
), births as (
  select distinct on (node_id) node_id, actor_id, created_at
  from all_births
  where nullif(node_id,'') is not null and public.is_pending_knowledge_node(node_id)
  order by node_id, sequence
), snapshots as (
  select b.*,
    greatest((select count(*) from public.knowledge_ball_profiles p
      where p.created_at <= b.created_at), 1)::bigint as eligible_snapshot
  from births b
)
insert into public.knowledge_pending_vote_rounds(
  node_id, round_no, policy_version, initiator_id, initiator_side,
  eligible_user_snapshot, required_votes, opened_at, deadline, legacy_unfunded
)
select node_id, 1, 'ORIGINAL_DESIGN_V1', actor_id, 'AGREE',
  eligible_snapshot, public.pending_vote_required_for_snapshot(eligible_snapshot),
  created_at, created_at + interval '720 hours', true
from snapshots
on conflict(node_id, round_no) do nothing;

alter table public.knowledge_pending_votes add column round_id uuid;
update public.knowledge_pending_votes vote
set round_id = round.id
from public.knowledge_pending_vote_rounds round
where round.node_id = vote.node_id and round.round_no = 1 and vote.round_id is null;
alter table public.knowledge_pending_votes alter column round_id set not null;
alter table public.knowledge_pending_votes
  add constraint knowledge_pending_votes_round_id_fkey
  foreign key(round_id) references public.knowledge_pending_vote_rounds(id);
create index knowledge_pending_votes_by_round_side
  on public.knowledge_pending_votes(round_id, side, created_at);

create or replace function public.pending_vote_round_for_node(target_node_id text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  result_id uuid;
  birth_actor uuid;
  birth_at timestamptz;
  user_snapshot bigint;
begin
  select id into result_id from public.knowledge_pending_vote_rounds
    where node_id = target_node_id and round_no = 1;
  if result_id is not null then return result_id; end if;
  if not public.is_pending_knowledge_node(target_node_id) then
    raise exception 'node is not pending or has not synchronized yet' using errcode = '22023';
  end if;

  select actor_id, created_at into birth_actor, birth_at
  from (
    select sequence, actor_id, created_at from public.public_knowledge_events
      where event_type='KnowledgeAdded' and (
        envelope#>>'{payload,edit,node,id}' = target_node_id
        or envelope#>>'{payload,edit,reasoning,id}' = target_node_id
        or envelope#>>'{payload,edit,conclusion,id}' = target_node_id
      )
    union all
    select sequence, actor_id, created_at from public.public_knowledge_events
      where event_type='NodeCreated' and envelope#>>'{payload,nodeId}' = target_node_id
  ) birth
  order by sequence limit 1;
  if birth_actor is null then raise exception 'pending node birth event not found' using errcode = '22023'; end if;

  select greatest(count(*),1)::bigint into user_snapshot
  from public.knowledge_ball_profiles where created_at <= birth_at;
  insert into public.knowledge_pending_vote_rounds(
    node_id, round_no, policy_version, initiator_id, initiator_side,
    eligible_user_snapshot, required_votes, opened_at, deadline, legacy_unfunded
  ) values(
    target_node_id, 1, 'ORIGINAL_DESIGN_V1', birth_actor, 'AGREE',
    user_snapshot, public.pending_vote_required_for_snapshot(user_snapshot),
    birth_at, birth_at + interval '720 hours', true
  ) on conflict(node_id, round_no) do update set node_id=excluded.node_id
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
  op_key text := 'claim-stake:' || source_event_id || ':' || target_node_id;
  request_hash text;
begin
  perform public.ensure_anonymous_profile();
  select id into result_id from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and round_no=1;
  if result_id is not null then return result_id; end if;

  select greatest(count(*),1)::bigint into user_snapshot
    from public.knowledge_ball_profiles where active;
  insert into public.knowledge_pending_vote_rounds(
    node_id, round_no, policy_version, initiator_id, initiator_side,
    eligible_user_snapshot, required_votes, opened_at, deadline, legacy_unfunded
  ) values(
    target_node_id, 1, 'ORIGINAL_DESIGN_V1', creator, 'AGREE',
    user_snapshot, public.pending_vote_required_for_snapshot(user_snapshot),
    opened, opened + interval '720 hours', false
  ) returning id into result_id;

  select id into creator_account from public.energy_accounts where user_id=creator for update;
  if creator_account is null then raise exception 'creator energy account not found'; end if;
  update public.energy_accounts set balance=balance-stake_amount
    where id=creator_account and balance-stake_amount >= -10.000000;
  if not found then raise exception 'insufficient energy for creator stake' using errcode='23514'; end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'node_id',target_node_id,'stake',stake_amount::text,'policy_version','ORIGINAL_DESIGN_V1'
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('CLAIM_STAKE',op_key,
    jsonb_build_object('operation','PENDING_CLAIM','node_id',target_node_id,'stake',stake_amount::text),
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
  decided_verdict text;
  decided_reason text;
  winning_side text;
  funded boolean;
  losing_atoms bigint;
  winner_count bigint;
  share_atoms bigint;
  remainder_atoms bigint;
  position_index bigint := 0;
  winner record;
  payout_atoms bigint;
  payout numeric(30,6);
  total_payout numeric(30,6) := 0.000000;
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

  if agree_count >= round_row.required_votes then
    decided_verdict := 'CORRECT'; decided_reason := 'THRESHOLD';
  elsif disagree_count >= round_row.required_votes then
    decided_verdict := 'INCORRECT'; decided_reason := 'THRESHOLD';
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

  if winning_side='AGREE' then
    losing_atoms := disagree_count::bigint * 1000000 + case when funded then 1000000 else 0 end;
    winner_count := agree_count::bigint + case when funded then 1 else 0 end;
  else
    losing_atoms := agree_count::bigint * 1000000 + case when funded then 1000000 else 0 end;
    winner_count := disagree_count::bigint + case when funded then 1 else 0 end;
  end if;
  if winner_count > 0 then
    share_atoms := losing_atoms / winner_count;
    remainder_atoms := losing_atoms % winner_count;
  else
    share_atoms := 0; remainder_atoms := 0;
  end if;

  trigger_actor := coalesce(auth.uid(), round_row.initiator_id);
  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'round_id',round_row.id,'verdict',decided_verdict,'agree_count',agree_count,
    'disagree_count',disagree_count,'required_votes',round_row.required_votes
  )::text,'UTF8')),'hex');
  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_SETTLEMENT','vote-settlement:'||round_row.id::text,
    jsonb_build_object('operation','PENDING_VOTE_SETTLEMENT','round_id',round_row.id,
      'node_id',round_row.node_id,'verdict',decided_verdict,'reason',decided_reason),
    trigger_actor,request_hash)
  returning id into tx;

  if winner_count > 0 then
    for winner in
      select position_key, account_id
      from (
        select 'creator:'||round_row.initiator_id::text as position_key, a.id as account_id
          from public.energy_accounts a
          where funded and winning_side='AGREE' and a.user_id=round_row.initiator_id
        union all
        select 'vote:'||v.id::text, a.id
          from public.knowledge_pending_votes v
          join public.energy_accounts a on a.user_id=v.voter_id
          where v.round_id=round_row.id and v.side=winning_side
        union all
        select 'system'::text, system_account
          where funded and winning_side='DISAGREE'
      ) positions
      order by position_key
    loop
      position_index := position_index + 1;
      payout_atoms := 1000000 + share_atoms
        + case when position_index <= remainder_atoms then 1 else 0 end;
      if winner.account_id <> system_account then
        payout := (payout_atoms::numeric / 1000000)::numeric(30,6);
        update public.energy_accounts set balance=balance+payout where id=winner.account_id;
        insert into public.energy_ledger_entries(transaction_id,account_id,amount)
          values(tx,winner.account_id,payout);
        total_payout := total_payout + payout;
      end if;
    end loop;
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
    verdict=decided_verdict, close_reason=decided_reason, closed_at=clock_timestamp(),
    final_agree_count=agree_count, final_disagree_count=disagree_count,
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
  my_balance numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into round_row from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and round_no=1;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;
  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count from public.knowledge_pending_votes where round_id=round_row.id;
  select side into my_side from public.knowledge_pending_votes
    where round_id=round_row.id and voter_id=actor;
  select balance into my_balance from public.energy_accounts where user_id=actor;
  return jsonb_build_object(
    'node_id',target_node_id,'round_id',round_row.id::text,
    'agree_count',agree_count,'disagree_count',disagree_count,
    'required_votes',round_row.required_votes,'my_side',my_side,
    'my_balance',case when my_balance is null then null else my_balance::text end,
    'verdict',round_row.verdict,'close_reason',round_row.close_reason,
    'deadline',round_row.deadline,'closed_at',round_row.closed_at,
    'policy_version',round_row.policy_version
  );
end $$;

create or replace function public.get_pending_knowledge_vote(target_node_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare round_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  round_id := public.pending_vote_round_for_node(target_node_id);
  perform public.finalize_pending_vote_round(round_id);
  return public.pending_vote_snapshot(target_node_id);
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
  select verdict into round_verdict from public.knowledge_pending_vote_rounds where id=vote_round_id;
  if round_verdict <> 'PENDING' then return public.pending_vote_snapshot(target_node_id); end if;

  select side into existing_side from public.knowledge_pending_votes
    where knowledge_pending_votes.round_id=vote_round_id and voter_id=actor;
  if found then
    if existing_side <> vote_side then raise exception 'vote already cast for this node' using errcode='23505'; end if;
    return public.pending_vote_snapshot(target_node_id);
  end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'node_id',target_node_id,'round_id',vote_round_id::text,'side',vote_side,'stake',stake_amount::text
  )::text,'UTF8')),'hex');
  select id,energy_transactions.request_hash into prior from public.energy_transactions
    where actor_id=actor and transaction_type='VOTE_STAKE' and idempotency_key=operation_key;
  if found then
    if prior.request_hash <> request_hash then raise exception 'idempotency key parameter mismatch' using errcode='22023'; end if;
    raise exception 'vote transaction exists without vote record' using errcode='XX000';
  end if;

  select id into user_account from public.energy_accounts where user_id=actor for update;
  if user_account is null then raise exception 'energy account not found'; end if;
  update public.energy_accounts set balance=balance-stake_amount
    where id=user_account and balance-stake_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode='23514'; end if;

  insert into public.energy_transactions(transaction_type,idempotency_key,metadata,actor_id,request_hash)
  values('VOTE_STAKE',operation_key,
    jsonb_build_object('operation','PENDING_VOTE','node_id',target_node_id,'round_id',vote_round_id::text,
      'side',vote_side,'stake',stake_amount::text),actor,request_hash)
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
declare item record; processed integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if max_rounds < 1 or max_rounds > 200 then raise exception 'invalid max_rounds' using errcode='22023'; end if;
  for item in
    select id from public.knowledge_pending_vote_rounds
    where verdict='PENDING' and deadline<=now()
    order by deadline,id limit max_rounds
  loop
    perform public.finalize_pending_vote_round(item.id);
    processed := processed + 1;
  end loop;
  return processed;
end $$;

create or replace function public.is_pending_knowledge_node(target_node_id text) returns boolean
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare born_at bigint;
begin
  if nullif(target_node_id,'') is null then return false; end if;
  select min(sequence) into born_at
  from public.public_knowledge_events
  where
    (event_type='KnowledgeAdded' and (
      envelope#>>'{payload,edit,node,id}'=target_node_id
      or envelope#>>'{payload,edit,reasoning,id}'=target_node_id
      or envelope#>>'{payload,edit,conclusion,id}'=target_node_id
    ))
    or (event_type='NodeCreated'
      and envelope#>>'{payload,nodeId}'=target_node_id
      and coalesce(envelope#>>'{payload,initialStatus}','pending')='pending');
  if born_at is null then return false; end if;
  return not exists (
    select 1 from public.public_knowledge_events event
    where event.sequence>born_at and (
      (event.event_type='KnowledgeVerdictFinalized'
        and event.envelope#>>'{payload,nodeId}'=target_node_id)
      or (event.event_type='KnowledgeStatusChanged'
        and event.envelope#>>'{payload,edit,nodeId}'=target_node_id
        and event.envelope#>>'{payload,edit,status}' in ('verified','suspended','disputed'))
      or (event.event_type='KnowledgeNegated'
        and event.envelope#>>'{payload,edit,targetId}'=target_node_id)
      or (event.event_type in ('NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved')
        and event.envelope#>>'{payload,nodeId}'=target_node_id)
      or (event.event_type='KnowledgeMerged' and (
        coalesce(event.envelope#>'{payload,edit,sourceNodeIds}','[]'::jsonb) ? target_node_id
        or exists(select 1 from jsonb_array_elements(coalesce(event.envelope#>'{payload,edit,chains}','[]'::jsonb)) chain
          where chain->>'reasoningId'=target_node_id or chain->>'conclusionId'=target_node_id)
      ))
      or (event.event_type='KnowledgeDecomposed' and (
        event.envelope#>>'{payload,edit,chain,reasoningId}'=target_node_id
        or event.envelope#>>'{payload,edit,chain,conclusionId}'=target_node_id
      ))
    )
  );
end $$;

-- Browser event batches may never forge protocol verdicts. Verdict rows are
-- inserted only by finalize_pending_vote_round after locks and settlement.
create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare kind text := item#>>'{payload,edit,kind}'; status text := item#>>'{payload,edit,status}';
begin
  if jsonb_path_exists(item,'$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode='22023';
  end if;
  if item->>'type'='KnowledgeVerdictFinalized' then
    raise exception 'protocol verdict events are server-only' using errcode='42501';
  end if;
  if (item->>'type',kind) in (('KnowledgeAdded','add'),('KnowledgeNegated','negate'),
      ('KnowledgeDecomposed','decompose'),('KnowledgeMerged','merge')) then return; end if;
  if item->>'type'='KnowledgeStatusChanged' and kind='status'
      and status in ('verified','suspended','disputed')
      and nullif(item#>>'{payload,edit,nodeId}','') is not null
      and (status<>'suspended' or nullif(item#>>'{payload,edit,causeNodeId}','') is not null) then return; end if;
  if item->>'type'='KnowledgeNodeEdited' and kind='update'
      and nullif(item#>>'{payload,edit,nodeId}','') is not null then return; end if;
  raise exception 'event type does not match canonical knowledge command' using errcode='22023';
end $$;

create or replace function public.append_public_knowledge_events(expected_head bigint,event_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  current_head bigint;
  item jsonb;
  existing jsonb;
  actor uuid := auth.uid();
  ids text[] := '{}';
  inserted_at timestamptz;
  added_node_id text;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_typeof(event_batch)<>'array' or jsonb_array_length(event_batch)>100 then
    raise exception 'invalid event batch' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence),0) into current_head from public.public_knowledge_events;
  if current_head<>expected_head then
    raise exception 'remote head conflict' using errcode='KB409',
      detail=jsonb_build_object('current_head',current_head)::text;
  end if;

  for item in select value from jsonb_array_elements(event_batch) loop
    if item->>'scope'<>'public' or (item->>'schemaVersion')::integer<>1
      or nullif(item->>'id','') is null or jsonb_typeof(item->'payload')<>'object'
      or octet_length(item::text)>65536 then
      raise exception 'invalid public event envelope' using errcode='22023';
    end if;
    perform public.validate_public_knowledge_event(item);
    select envelope into existing from public.public_knowledge_events where event_id=item->>'id';
    if existing is not null and existing<>item then
      raise exception 'event id already has a different envelope' using errcode='23505';
    end if;

    inserted_at := null;
    insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
      values(item->>'id',1,item->>'type',item,actor)
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
        perform public.fund_new_pending_vote_round(added_node_id,actor,inserted_at,item->>'id');
      end loop;
    end if;
    ids := array_append(ids,item->>'id');
  end loop;
  select coalesce(max(sequence),0) into current_head from public.public_knowledge_events;
  return jsonb_build_object('head',current_head,'acknowledged_event_ids',to_jsonb(ids));
end $$;

revoke all on function public.pending_vote_required_for_snapshot(bigint),
  public.pending_vote_round_for_node(text),
  public.fund_new_pending_vote_round(text,uuid,timestamptz,text),
  public.finalize_pending_vote_round(uuid),
  public.pending_vote_snapshot(text),
  public.get_pending_knowledge_vote(text),
  public.cast_pending_knowledge_vote(text,text,text),
  public.settle_expired_pending_knowledge_votes(integer),
  public.is_pending_knowledge_node(text),
  public.validate_public_knowledge_event(jsonb),
  public.append_public_knowledge_events(bigint,jsonb)
from public,anon,authenticated;
grant execute on function public.get_pending_knowledge_vote(text),
  public.cast_pending_knowledge_vote(text,text,text),
  public.settle_expired_pending_knowledge_votes(integer),
  public.append_public_knowledge_events(bigint,jsonb)
to authenticated;

comment on table public.knowledge_pending_vote_rounds is
  'ORIGINAL_DESIGN_V1 snapshotted initial verification rounds. Legacy backfills never retroactively charge creators.';
comment on function public.finalize_pending_vote_round(uuid) is
  'Internal idempotent verdict/settlement engine. Threshold and 720-hour timeout decisions serialize on the round row.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
