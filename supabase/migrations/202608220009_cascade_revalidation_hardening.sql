-- Knowledge Lineage V3 convergence / part 3.
-- Harden the automatic dependency cascade introduced in 202608220008:
-- * use disputed only as the existing flashing projection state;
-- * keep the CASCADE round as the authoritative PENDING state;
-- * no initiator / no creator wager / ordinary votes cost exactly 1;
-- * 720h exact tie remains PENDING; a later ordinary vote may break it;
-- * cascade completion emits only KnowledgeStatusChanged (verified/suspended),
--   never a first-round KnowledgeVerdictFinalized event;
-- * ordinary product writes cannot bypass an active cascade.

create or replace function private.has_active_cascade_round(target_node_id text) returns boolean
language sql stable security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.knowledge_pending_vote_rounds r
    where r.node_id=target_node_id
      and r.verdict='PENDING'
      and r.round_kind='CASCADE'
  )
$$;
revoke all on function private.has_active_cascade_round(text) from public,anon,authenticated;

-- 008 already contains the proven INITIAL/V2 settlement behavior. Preserve that
-- exact implementation under a private-use public-schema name, then route only
-- CASCADE rounds to the dedicated finalizer below.
do $$
begin
  if to_regprocedure('public.finalize_pending_vote_round_v2_and_legacy(uuid)') is null then
    alter function public.finalize_pending_vote_round(uuid)
      rename to finalize_pending_vote_round_v2_and_legacy;
  end if;
end $$;
revoke all on function public.finalize_pending_vote_round_v2_and_legacy(uuid) from public,anon,authenticated;

create or replace function private.finalize_cascade_pending_vote_round(target_round_id uuid) returns jsonb
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
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
  losing_atoms bigint;
  winner_count bigint;
  share_atoms bigint:=0;
  remainder_atoms bigint:=0;
  position_index bigint:=0;
  winner record;
  void_vote record;
  payout_atoms bigint;
  payout numeric(30,6);
  total_payout numeric(30,6):=0.000000;
  tx uuid;
  system_account constant uuid:='00000000-0000-0000-0000-000000000001';
  trigger_actor uuid;
  request_hash text;
  status_event jsonb;
begin
  select * into round_row
  from public.knowledge_pending_vote_rounds
  where id=target_round_id
  for update;
  if not found then raise exception 'pending vote round not found' using errcode='22023'; end if;
  if round_row.round_kind<>'CASCADE' then
    raise exception 'not an automatic cascade round' using errcode='22023';
  end if;

  if round_row.verdict<>'PENDING' then
    select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
      into agree_count,disagree_count
    from public.knowledge_pending_votes
    where round_id=round_row.id and settlement_status='ACTIVE';
    return jsonb_build_object(
      'verdict',round_row.verdict,'close_reason',round_row.close_reason,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false
    );
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
      decided_verdict:='CORRECT';
      closure_at:=agree_threshold_at;
      closure_id:=agree_threshold_id;
    else
      decided_verdict:='INCORRECT';
      closure_at:=disagree_threshold_at;
      closure_id:=disagree_threshold_id;
    end if;
    decided_reason:='THRESHOLD';

    -- Votes that arrive after the decisive threshold are invalid and refunded.
    update public.knowledge_pending_votes
    set settlement_status='VOID_LATE'
    where round_id=round_row.id
      and settlement_status='ACTIVE'
      and (created_at>closure_at or (created_at=closure_at and id::text>closure_id::text));
  elsif now()>=round_row.deadline then
    -- The recovered V3 product contract is explicit: exact tie stays PENDING.
    -- Because the round remains open, later ordinary votes are valid. As soon as
    -- they break the tie, timeout majority can settle even below threshold.
    if agree_count=disagree_count then
      return jsonb_build_object(
        'verdict','PENDING','close_reason',null,
        'agree_count',agree_count,'disagree_count',disagree_count,'tied',true
      );
    end if;
    decided_verdict:=case when agree_count>disagree_count then 'CORRECT' else 'INCORRECT' end;
    decided_reason:='TIMEOUT';
  else
    return jsonb_build_object(
      'verdict','PENDING','close_reason',null,
      'agree_count',agree_count,'disagree_count',disagree_count,'tied',false
    );
  end if;

  select count(*) filter(where side='AGREE'),count(*) filter(where side='DISAGREE')
    into agree_count,disagree_count
  from public.knowledge_pending_votes
  where round_id=round_row.id and settlement_status='ACTIVE';

  winning_side:=case when decided_verdict='CORRECT' then 'AGREE' else 'DISAGREE' end;
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

  trigger_actor:=auth.uid();
  if trigger_actor is null then
    select actor_id into trigger_actor
    from public.public_knowledge_events
    where event_id=round_row.source_event_id
    limit 1;
  end if;
  if trigger_actor is null then
    raise exception 'cascade settlement actor unavailable' using errcode='XX000';
  end if;

  request_hash:=encode(sha256(convert_to(jsonb_build_object(
    'round_id',round_row.id,
    'round_kind','CASCADE',
    'verdict',decided_verdict,
    'agree_count',agree_count,
    'disagree_count',disagree_count,
    'required_votes',round_row.required_votes,
    'policy_version',round_row.policy_version,
    'timeout_model','TIE_STAYS_PENDING',
    'pool_model','ORDINARY_ONLY',
    'invalid_vote_policy','REFUND'
  )::text,'UTF8')),'hex');

  insert into public.energy_transactions(
    transaction_type,idempotency_key,metadata,actor_id,request_hash
  ) values(
    'VOTE_SETTLEMENT',
    'cascade-vote-settlement:'||round_row.id::text,
    jsonb_build_object(
      'operation','CASCADE_REVALIDATION_SETTLEMENT',
      'round_id',round_row.id,
      'round_kind','CASCADE',
      'node_id',round_row.node_id,
      'verdict',decided_verdict,
      'reason',decided_reason,
      'policy_version',round_row.policy_version,
      'timeout_model','TIE_STAYS_PENDING',
      'pool_model','ORDINARY_ONLY',
      'invalid_vote_policy','REFUND'
    ),
    trigger_actor,
    request_hash
  ) returning id into tx;

  -- Refund votes invalidated only because they arrived after the decisive
  -- threshold. There is no creator/initiator position in a cascade round.
  for void_vote in
    select v.id,v.stake,a.id as account_id
    from public.knowledge_pending_votes v
    join public.energy_accounts a on a.user_id=v.voter_id
    where v.round_id=round_row.id
      and v.settlement_status<>'ACTIVE'
      and v.refunded_transaction_id is null
    order by v.created_at,v.id
  loop
    update public.energy_accounts
    set balance=balance+void_vote.stake
    where id=void_vote.account_id;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,void_vote.account_id,void_vote.stake);
    update public.knowledge_pending_votes
    set refunded_transaction_id=tx
    where id=void_vote.id;
    total_payout:=total_payout+void_vote.stake;
  end loop;

  if winner_count>0 then
    for winner in
      select 'vote:'||v.id::text as position_key,a.id as account_id
      from public.knowledge_pending_votes v
      join public.energy_accounts a on a.user_id=v.voter_id
      where v.round_id=round_row.id
        and v.side=winning_side
        and v.settlement_status='ACTIVE'
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

  if total_payout<>0 then
    update public.energy_accounts
    set balance=balance-total_payout
    where id=system_account;
    insert into public.energy_ledger_entries(transaction_id,account_id,amount)
      values(tx,system_account,-total_payout);
  end if;

  -- Internal projection write. The transaction-local flag is checked by the
  -- guard trigger below so a normal client cannot resolve/dispute/suspend an
  -- active cascade out-of-band.
  perform set_config('knowledge_ball.internal_cascade_write','1',true);
  status_event:=jsonb_build_object(
    'id','cascade-result:'||round_row.id::text,
    'type','KnowledgeStatusChanged',
    'scope','public',
    'schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object('edit',jsonb_build_object(
      'kind','status',
      'nodeId',round_row.node_id,
      'status',case when decided_verdict='CORRECT' then 'verified' else 'suspended' end,
      'causeNodeId',round_row.source_node_id
    ))
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(status_event->>'id',1,'KnowledgeStatusChanged',status_event,trigger_actor)
  on conflict(event_id) do nothing;
  perform set_config('knowledge_ball.internal_cascade_write','0',true);

  update public.knowledge_pending_vote_rounds
  set verdict=decided_verdict,
      close_reason=decided_reason,
      closed_at=clock_timestamp(),
      final_agree_count=agree_count,
      final_disagree_count=disagree_count,
      settlement_transaction_id=tx
  where id=round_row.id;

  perform public.assert_energy_conservation();
  return jsonb_build_object(
    'verdict',decided_verdict,
    'close_reason',decided_reason,
    'agree_count',agree_count,
    'disagree_count',disagree_count,
    'tied',false
  );
end $$;
revoke all on function private.finalize_cascade_pending_vote_round(uuid) from public,anon,authenticated;

create or replace function public.finalize_pending_vote_round(target_round_id uuid) returns jsonb
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare kind text;
begin
  select round_kind into kind
  from public.knowledge_pending_vote_rounds
  where id=target_round_id;
  if kind is null then raise exception 'pending vote round not found' using errcode='22023'; end if;
  if kind='CASCADE' then
    return private.finalize_cascade_pending_vote_round(target_round_id);
  end if;
  return public.finalize_pending_vote_round_v2_and_legacy(target_round_id);
end $$;
revoke all on function public.finalize_pending_vote_round(uuid) from public,anon;
grant execute on function public.finalize_pending_vote_round(uuid) to authenticated;

-- Server-side creation of the authoritative cascade round. The visible node
-- uses the existing disputed state because module 7 already pulses both pending
-- and disputed; the round row, not the display state, owns PENDING truth.
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
  if nullif(target_node_id,'') is null
     or nullif(source_node_id,'') is null
     or nullif(triggering_event_id,'') is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended('cascade-verification:'||target_node_id,0));
  if exists(
    select 1 from public.knowledge_pending_vote_rounds
    where node_id=target_node_id and verdict='PENDING'
  ) then return false; end if;

  select coalesce(max(round_no),0)+1 into next_round
  from public.knowledge_pending_vote_rounds
  where node_id=target_node_id;
  select greatest(count(*),1)::bigint into snapshot
  from public.knowledge_ball_profiles
  where active;

  insert into public.knowledge_pending_vote_rounds(
    node_id,round_no,policy_version,initiator_id,initiator_side,
    eligible_user_snapshot,required_votes,opened_at,deadline,
    creator_stake_transaction_id,legacy_unfunded,
    round_kind,source_node_id,source_event_id
  ) values(
    target_node_id,
    next_round,
    'ORIGINAL_DESIGN_V1',
    null,
    null,
    snapshot,
    public.pending_vote_required_for_snapshot(snapshot),
    opened,
    opened+interval '720 hours',
    null,
    true,
    'CASCADE',
    source_node_id,
    triggering_event_id
  );

  perform set_config('knowledge_ball.internal_cascade_write','1',true);
  event_envelope:=jsonb_build_object(
    'id','cascade-revalidation:'||triggering_event_id||':'||target_node_id,
    'type','KnowledgeStatusChanged',
    'scope','public',
    'schemaVersion',1,
    'timestamp',floor(extract(epoch from clock_timestamp())*1000)::bigint,
    'payload',jsonb_build_object('edit',jsonb_build_object(
      'kind','status',
      'nodeId',target_node_id,
      'status','disputed',
      'causeNodeId',source_node_id
    ))
  );
  insert into public.public_knowledge_events(event_id,schema_version,event_type,envelope,actor_id)
  values(event_envelope->>'id',1,'KnowledgeStatusChanged',event_envelope,triggering_actor)
  on conflict(event_id) do nothing;
  perform set_config('knowledge_ball.internal_cascade_write','0',true);
  return true;
end $$;
revoke all on function private.start_cascade_knowledge_revalidation(text,text,text,uuid)
from public,anon,authenticated;

-- Active cascade rounds serialize all topic head-changing product actions.
create or replace function private.guard_lineage_candidate_insert() returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare topic_value text; target_value text;
begin
  if new.event_type<>'KnowledgeAdded' then return new; end if;
  if new.envelope#>'{payload,optimization}' is null
     and new.envelope#>'{payload,opposition}' is null then return new; end if;

  topic_value:=coalesce(
    new.envelope#>>'{payload,optimization,topicId}',
    new.envelope#>>'{payload,opposition,topicId}'
  );
  target_value:=coalesce(
    new.envelope#>>'{payload,optimization,targetId}',
    new.envelope#>>'{payload,opposition,targetId}'
  );
  if nullif(topic_value,'') is null or nullif(target_value,'') is null then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('knowledge-head-change:'||topic_value,0));
  if exists(
    select 1 from private.knowledge_revalidation_rounds r
    where r.topic_id=topic_value and r.verdict='PENDING'
  ) then
    raise exception 'knowledge topic already has an active revalidation round' using errcode='KB409';
  end if;
  if private.has_active_cascade_round(target_value) then
    raise exception 'knowledge topic current head is under cascade revalidation' using errcode='KB409';
  end if;
  return new;
end $$;
revoke all on function private.guard_lineage_candidate_insert() from public,anon,authenticated;

create or replace function private.guard_revalidation_head_change_insert() returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare current_id text;
begin
  perform pg_advisory_xact_lock(hashtextextended('knowledge-head-change:'||new.topic_id,0));
  if exists(
    select 1 from private.knowledge_lineage_members m
    where m.topic_id=new.topic_id
      and m.role in('candidate-history','candidate-opposition')
  ) then
    raise exception 'knowledge topic already has a pending head-change candidate' using errcode='KB409';
  end if;
  select node_id into current_id
  from private.knowledge_lineage_members
  where topic_id=new.topic_id and role='current'
  limit 1;
  if current_id is not null and private.has_active_cascade_round(current_id) then
    raise exception 'knowledge topic current head is under cascade revalidation' using errcode='KB409';
  end if;
  return new;
end $$;
revoke all on function private.guard_revalidation_head_change_insert() from public,anon,authenticated;

-- Existing status commands remain available generally, but not as a way to
-- escape an authoritative open cascade round. Only the SECURITY DEFINER cascade
-- functions above set this transaction-local internal flag.
create or replace function private.guard_active_cascade_status_write() returns trigger
language plpgsql security definer
set search_path=private,public,pg_temp
as $$
declare target_id text;
begin
  if new.event_type<>'KnowledgeStatusChanged' then return new; end if;
  target_id:=new.envelope#>>'{payload,edit,nodeId}';
  if nullif(target_id,'') is null or not private.has_active_cascade_round(target_id) then return new; end if;
  if current_setting('knowledge_ball.internal_cascade_write',true)='1' then return new; end if;
  raise exception 'active cascade revalidation can only be finalized by its vote round' using errcode='KB409';
end $$;
revoke all on function private.guard_active_cascade_status_write() from public,anon,authenticated;

drop trigger if exists ab_guard_active_cascade_status_write on public.public_knowledge_events;
create trigger ab_guard_active_cascade_status_write
before insert on public.public_knowledge_events
for each row execute function private.guard_active_cascade_status_write();

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer
set search_path=public,pg_temp
as $$ select '202608220009'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
