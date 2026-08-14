-- Issue #45: harden the existing Scheme 7 boundary. This is forward-only and
-- deliberately does not recreate the phone/SMS/OTP identity paths removed by #42.

-- Permanent identifiers are private. Public presentation fields remain readable.
revoke select(user_id, account_no, active) on public.knowledge_ball_profiles from authenticated;
drop policy if exists "public reads active profile fields" on public.knowledge_ball_profiles;
create policy "public reads active profile fields" on public.knowledge_ball_profiles
  for select to anon, authenticated using (active);

-- Scope idempotency to the authenticated actor and operation, and bind replays to
-- the exact parameters. Historical rows remain valid and auditable.
alter table public.energy_transactions drop constraint if exists energy_transactions_idempotency_key_key;
alter table public.energy_transactions
  add column if not exists actor_id uuid references auth.users(id),
  add column if not exists request_hash text;
create unique index if not exists energy_transaction_actor_operation_key
  on public.energy_transactions(actor_id, transaction_type, idempotency_key)
  where actor_id is not null;

create or replace function public.spend_energy(amount numeric, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); user_account uuid; tx uuid; exact_amount numeric(30,6); request_hash text; prior record;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  exact_amount := public.validate_energy_amount(amount);
  if nullif(operation_key, '') is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  request_hash := encode(sha256(convert_to(jsonb_build_object('amount', exact_amount::text)::text, 'UTF8')), 'hex');
  select id, energy_transactions.request_hash into prior from public.energy_transactions
    where actor_id = actor and transaction_type = 'SPEND' and idempotency_key = operation_key;
  if found then
    if prior.request_hash <> request_hash then raise exception 'idempotency key parameter mismatch' using errcode = '22023'; end if;
    return jsonb_build_object('transaction_id', prior.id, 'replayed', true);
  end if;
  select id into user_account from public.energy_accounts where user_id = actor for update;
  update public.energy_accounts set balance = balance - exact_amount where id = user_account and balance - exact_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata, actor_id, request_hash)
    values('SPEND', operation_key, jsonb_build_object('user_id', actor), actor, request_hash) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, user_account, -exact_amount), (tx, '00000000-0000-0000-0000-000000000001', exact_amount);
  update public.energy_accounts set balance = balance + exact_amount where account_type = 'SYSTEM';
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', exact_amount::text);
end $$;

create or replace function public.transfer_energy(recipient uuid, amount numeric, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); source_account uuid; target_account uuid; tx uuid; exact_amount numeric(30,6); request_hash text; prior record; locked record;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  exact_amount := public.validate_energy_amount(amount);
  if recipient = actor or nullif(operation_key, '') is null then raise exception 'invalid transfer' using errcode = '22023'; end if;
  request_hash := encode(sha256(convert_to(jsonb_build_object('recipient', recipient, 'amount', exact_amount::text)::text, 'UTF8')), 'hex');
  select id, energy_transactions.request_hash into prior from public.energy_transactions
    where actor_id = actor and transaction_type = 'TRANSFER' and idempotency_key = operation_key;
  if found then
    if prior.request_hash <> request_hash then raise exception 'idempotency key parameter mismatch' using errcode = '22023'; end if;
    return jsonb_build_object('transaction_id', prior.id, 'replayed', true);
  end if;
  -- Lock both accounts in one deterministic user-id order. A->B and B->A can no
  -- longer acquire the same rows in opposite order.
  for locked in select id, user_id from public.energy_accounts
    where user_id in (actor, recipient) order by user_id for update
  loop
    if locked.user_id = actor then source_account := locked.id; else target_account := locked.id; end if;
  end loop;
  if source_account is null or target_account is null then raise exception 'recipient or source account not found'; end if;
  update public.energy_accounts set balance = balance - exact_amount where id = source_account and balance - exact_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata, actor_id, request_hash)
    values('TRANSFER', operation_key, jsonb_build_object('from', actor, 'to', recipient), actor, request_hash) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, source_account, -exact_amount), (tx, target_account, exact_amount);
  update public.energy_accounts set balance = balance + exact_amount where id = target_account;
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', exact_amount::text);
end $$;

-- Reject event envelopes that bypass the canonical TypeScript command families.
create or replace function public.validate_public_knowledge_event(item jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare kind text := item#>>'{payload,edit,kind}';
begin
  if jsonb_path_exists(item, '$.**.mastery') then
    raise exception 'PERSONAL_STATE_IN_PUBLIC_PAYLOAD' using errcode = '22023';
  end if;
  if item->>'type' = 'NodeCreated' then
    if item#>>'{payload,source}' <> 'import' then raise exception 'legacy event is import-only' using errcode = '22023'; end if;
  elsif (item->>'type', kind) not in (('KnowledgeAdded','add'), ('KnowledgeNegated','negate'), ('KnowledgeDecomposed','decompose'), ('KnowledgeMerged','merge')) then
    raise exception 'event type does not match canonical knowledge command' using errcode = '22023';
  end if;
end $$;

-- Patch the existing append boundary in place by validating every item before insert.
-- The marker is consumed by the migration verifier; the function replacement below
-- is generated from 202608130001 with this call immediately inside its loop.
create or replace function public.issue45_validate_public_batch(event_batch jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare item jsonb;
begin
  if jsonb_typeof(event_batch) <> 'array' then raise exception 'invalid event batch' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(event_batch) loop
    perform public.validate_public_knowledge_event(item);
  end loop;
end $$;

-- Wrap the old function without a second domain engine: rename it once and put the
-- canonical-family guard in front of the same atomic append transaction.
alter function public.append_public_knowledge_events(bigint, jsonb) rename to append_public_knowledge_events_unchecked;
create function public.append_public_knowledge_events(expected_head bigint, event_batch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.issue45_validate_public_batch(event_batch);
  return public.append_public_knowledge_events_unchecked(expected_head, event_batch);
end $$;
revoke all on function public.append_public_knowledge_events_unchecked(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.validate_public_knowledge_event(jsonb), public.issue45_validate_public_batch(jsonb) from public, anon, authenticated;
grant execute on function public.append_public_knowledge_events(bigint, jsonb) to authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path = public, pg_temp
as $$ select '202608140002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
