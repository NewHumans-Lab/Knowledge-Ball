-- Pending-node ordinary voting. Reuse the existing conserved energy ledger;
-- the vote row and the 1-energy stake are committed atomically in one RPC.

alter table public.energy_transactions drop constraint if exists energy_transactions_transaction_type_check;
alter table public.energy_transactions add constraint energy_transactions_transaction_type_check
  check (transaction_type in ('REFERRAL', 'SPEND', 'TRANSFER', 'VOTE_STAKE'));

create table public.knowledge_pending_votes (
  id uuid primary key default gen_random_uuid(),
  node_id text not null,
  voter_id uuid not null references auth.users(id),
  side text not null check (side in ('AGREE', 'DISAGREE')),
  stake numeric(30,6) not null default 1.000000 check (stake = 1.000000),
  transaction_id uuid not null unique references public.energy_transactions(id),
  created_at timestamptz not null default now(),
  unique(node_id, voter_id)
);
create index knowledge_pending_votes_by_node on public.knowledge_pending_votes(node_id, side, created_at);
alter table public.knowledge_pending_votes enable row level security;
revoke all on public.knowledge_pending_votes from public, anon, authenticated;

-- Canonical KnowledgeAdded nodes start pending. Legacy NodeCreated imports are
-- pending only when initialStatus is absent/pending. A node stops accepting
-- ordinary votes after a status decision or an edit operation that retires it.
create or replace function public.is_pending_knowledge_node(target_node_id text) returns boolean
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare born_at bigint;
begin
  if nullif(target_node_id, '') is null then return false; end if;

  select min(sequence) into born_at
  from public.public_knowledge_events
  where
    (event_type = 'KnowledgeAdded' and (
      envelope#>>'{payload,edit,node,id}' = target_node_id
      or envelope#>>'{payload,edit,reasoning,id}' = target_node_id
      or envelope#>>'{payload,edit,conclusion,id}' = target_node_id
    ))
    or (event_type = 'NodeCreated'
      and envelope#>>'{payload,nodeId}' = target_node_id
      and coalesce(envelope#>>'{payload,initialStatus}', 'pending') = 'pending');

  if born_at is null then return false; end if;

  return not exists (
    select 1 from public.public_knowledge_events event
    where event.sequence > born_at and (
      (event.event_type = 'KnowledgeStatusChanged'
        and event.envelope#>>'{payload,edit,nodeId}' = target_node_id
        and event.envelope#>>'{payload,edit,status}' in ('verified','suspended','disputed'))
      or (event.event_type = 'KnowledgeNegated'
        and event.envelope#>>'{payload,edit,targetId}' = target_node_id)
      or (event.event_type in ('NodeFalsified','NodeSuspended','NodeDisputed','NodeResolved')
        and event.envelope#>>'{payload,nodeId}' = target_node_id)
      or (event.event_type = 'KnowledgeMerged' and (
        coalesce(event.envelope#>'{payload,edit,sourceNodeIds}', '[]'::jsonb) ? target_node_id
        or exists (
          select 1 from jsonb_array_elements(coalesce(event.envelope#>'{payload,edit,chains}', '[]'::jsonb)) chain
          where chain->>'reasoningId' = target_node_id or chain->>'conclusionId' = target_node_id
        )
      ))
      or (event.event_type = 'KnowledgeDecomposed' and (
        event.envelope#>>'{payload,edit,chain,reasoningId}' = target_node_id
        or event.envelope#>>'{payload,edit,chain,conclusionId}' = target_node_id
      ))
    )
  );
end $$;

create or replace function public.pending_vote_required() returns integer
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare user_snapshot bigint; required integer := 1; tier bigint := 10;
begin
  select greatest(count(*), 1) into user_snapshot from public.knowledge_ball_profiles where active;
  while user_snapshot >= tier loop
    required := required * 2;
    if tier > 100000000000000000 then exit; end if;
    tier := tier * 10;
  end loop;
  return required;
end $$;

create or replace function public.get_pending_knowledge_vote(target_node_id text) returns jsonb
language plpgsql security definer stable set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  agree_count integer;
  disagree_count integer;
  my_side text;
  required_votes integer;
  my_balance numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.is_pending_knowledge_node(target_node_id) then
    raise exception 'node is not pending or has not synchronized yet' using errcode = '22023';
  end if;

  select count(*) filter (where side = 'AGREE'), count(*) filter (where side = 'DISAGREE')
    into agree_count, disagree_count from public.knowledge_pending_votes where node_id = target_node_id;
  select side into my_side from public.knowledge_pending_votes where node_id = target_node_id and voter_id = actor;
  select balance into my_balance from public.energy_accounts where user_id = actor;
  required_votes := public.pending_vote_required();

  return jsonb_build_object(
    'node_id', target_node_id,
    'agree_count', agree_count,
    'disagree_count', disagree_count,
    'required_votes', required_votes,
    'my_side', my_side,
    'my_balance', case when my_balance is null then null else my_balance::text end
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
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if vote_side not in ('AGREE','DISAGREE') then raise exception 'invalid vote side' using errcode = '22023'; end if;
  if nullif(target_node_id, '') is null or nullif(operation_key, '') is null then
    raise exception 'node id and idempotency key required' using errcode = '22023';
  end if;

  perform public.ensure_anonymous_profile();
  -- Serialize decisions for this node. This also makes the one-vote check and
  -- tally deterministic under simultaneous mobile submissions.
  perform pg_advisory_xact_lock(hashtextextended('pending-vote:' || target_node_id, 0));

  if not public.is_pending_knowledge_node(target_node_id) then
    raise exception 'node is not pending or has not synchronized yet' using errcode = '22023';
  end if;

  select side into existing_side from public.knowledge_pending_votes
    where node_id = target_node_id and voter_id = actor;
  if found then
    if existing_side <> vote_side then raise exception 'vote already cast for this node' using errcode = '23505'; end if;
    return public.get_pending_knowledge_vote(target_node_id);
  end if;

  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'node_id', target_node_id, 'side', vote_side, 'stake', stake_amount::text
  )::text, 'UTF8')), 'hex');
  select id, energy_transactions.request_hash into prior from public.energy_transactions
    where actor_id = actor and transaction_type = 'VOTE_STAKE' and idempotency_key = operation_key;
  if found then
    if prior.request_hash <> request_hash then raise exception 'idempotency key parameter mismatch' using errcode = '22023'; end if;
    -- An atomic transaction cannot contain the transaction without its vote row.
    -- Treat such a state as corruption rather than charging again.
    raise exception 'vote transaction exists without vote record' using errcode = 'XX000';
  end if;

  select id into user_account from public.energy_accounts where user_id = actor for update;
  if user_account is null then raise exception 'energy account not found'; end if;
  update public.energy_accounts set balance = balance - stake_amount
    where id = user_account and balance - stake_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;

  insert into public.energy_transactions(transaction_type, idempotency_key, metadata, actor_id, request_hash)
    values('VOTE_STAKE', operation_key,
      jsonb_build_object('operation','PENDING_VOTE','node_id',target_node_id,'side',vote_side,'stake',stake_amount::text),
      actor, request_hash) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, user_account, -stake_amount),
    (tx, '00000000-0000-0000-0000-000000000001', stake_amount);
  update public.energy_accounts set balance = balance + stake_amount where account_type = 'SYSTEM';
  insert into public.knowledge_pending_votes(node_id, voter_id, side, stake, transaction_id)
    values(target_node_id, actor, vote_side, stake_amount, tx);

  perform public.assert_energy_conservation();
  return public.get_pending_knowledge_vote(target_node_id);
end $$;

comment on table public.knowledge_pending_votes is
  'Ordinary pending-node vote stakes. Final verdict/settlement remains owned by the frozen truth protocol and is not inferred by this UI migration.';

revoke all on function public.is_pending_knowledge_node(text), public.pending_vote_required(),
  public.get_pending_knowledge_vote(text), public.cast_pending_knowledge_vote(text,text,text)
  from public, anon, authenticated;
grant execute on function public.get_pending_knowledge_vote(text), public.cast_pending_knowledge_vote(text,text,text)
  to authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path = public, pg_temp
as $$ select '202608170001'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
