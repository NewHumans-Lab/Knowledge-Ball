-- Phone identity and conserved-energy accounting. All accounting writes are RPC-only.
create table public.phone_registration_registry (
  phone_normalized text primary key check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  first_user_id uuid not null,
  first_registered_at timestamptz not null default now()
);

create table public.knowledge_ball_profiles (
  user_id uuid primary key references auth.users(id),
  phone_normalized text not null check (phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_active_account_per_phone
  on public.knowledge_ball_profiles(phone_normalized) where active;

create table public.energy_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (account_type in ('USER', 'SYSTEM')),
  user_id uuid unique references auth.users(id),
  balance bigint not null default 0,
  created_at timestamptz not null default now(),
  check ((account_type = 'USER' and user_id is not null and balance >= -10)
      or (account_type = 'SYSTEM' and user_id is null))
);
create unique index exactly_one_system_account on public.energy_accounts((account_type))
  where account_type = 'SYSTEM';
insert into public.energy_accounts(id, account_type, balance)
values ('00000000-0000-0000-0000-000000000001', 'SYSTEM', 0)
on conflict do nothing;

create table public.energy_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null check (transaction_type in ('REFERRAL', 'SPEND', 'TRANSFER')),
  status text not null default 'COMPLETED' check (status = 'COMPLETED'),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.energy_ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.energy_transactions(id),
  account_id uuid not null references public.energy_accounts(id),
  amount bigint not null check (amount <> 0),
  created_at timestamptz not null default now()
);
create index energy_ledger_by_account on public.energy_ledger_entries(account_id, id);

create table public.referrals (
  inviter_user_id uuid not null references auth.users(id),
  new_user_id uuid primary key references auth.users(id),
  new_user_phone_identity text not null references public.phone_registration_registry(phone_normalized),
  reward_transaction_id uuid not null unique references public.energy_transactions(id),
  created_at timestamptz not null default now()
);

alter table public.phone_registration_registry enable row level security;
alter table public.knowledge_ball_profiles enable row level security;
alter table public.energy_accounts enable row level security;
alter table public.energy_transactions enable row level security;
alter table public.energy_ledger_entries enable row level security;
alter table public.referrals enable row level security;
revoke all on public.phone_registration_registry, public.knowledge_ball_profiles,
  public.energy_accounts, public.energy_transactions, public.energy_ledger_entries,
  public.referrals from anon, authenticated;

create or replace function public.normalize_e164(raw_phone text) returns text
language plpgsql immutable strict set search_path = public, pg_temp as $$
declare normalized text := regexp_replace(trim(raw_phone), '[[:space:]().-]', '', 'g');
begin
  if left(normalized, 2) = '00' then normalized := '+' || substr(normalized, 3); end if;
  if normalized !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'invalid E.164 phone' using errcode = '22023'; end if;
  return normalized;
end $$;

create or replace function public.assert_energy_conservation() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare global_total numeric; system_count bigint; bad_transactions bigint; bad_balances bigint;
begin
  select count(*), coalesce(sum(balance), 0) into system_count, global_total
    from public.energy_accounts where account_type = 'SYSTEM';
  if system_count <> 1 then raise exception 'exactly one SYSTEM account required'; end if;
  select coalesce(sum(balance), 0) into global_total from public.energy_accounts;
  if global_total <> 0 then raise exception 'global energy conservation violated: %', global_total; end if;
  select count(*) into bad_transactions from (
    select transaction_id from public.energy_ledger_entries group by transaction_id having sum(amount) <> 0
  ) unbalanced;
  if bad_transactions <> 0 then raise exception 'unbalanced ledger transaction'; end if;
  select count(*) into bad_balances from public.energy_accounts account
    where account.balance <> coalesce((select sum(entry.amount) from public.energy_ledger_entries entry where entry.account_id = account.id), 0);
  if bad_balances <> 0 then raise exception 'materialized balance differs from ledger'; end if;
  return jsonb_build_object('global_total', global_total, 'system_accounts', system_count);
end $$;

create or replace function public.register_verified_phone(
  verified_phone text, inviter uuid default null, operation_key text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); normalized text; newcomer boolean; inviter_account uuid; tx uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if nullif(operation_key, '') is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  normalized := public.normalize_e164(verified_phone);
  -- The authenticated provider must supply the same verified phone in the JWT.
  if coalesce(auth.jwt()->>'phone', '') = '' or public.normalize_e164(auth.jwt()->>'phone') <> normalized then
    raise exception 'verified phone mismatch' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized, 0));
  if exists(select 1 from public.knowledge_ball_profiles where phone_normalized = normalized and active and user_id <> actor) then
    raise exception 'phone already has an active account' using errcode = '23505';
  end if;
  newcomer := not exists(select 1 from public.phone_registration_registry where phone_normalized = normalized);
  insert into public.phone_registration_registry(phone_normalized, first_user_id) values(normalized, actor) on conflict do nothing;
  insert into public.knowledge_ball_profiles(user_id, phone_normalized, active) values(actor, normalized, true)
    on conflict(user_id) do update set active = true
    where public.knowledge_ball_profiles.phone_normalized = excluded.phone_normalized;
  if not found then raise exception 'phone changes require change_verified_phone' using errcode = '22023'; end if;
  insert into public.energy_accounts(account_type, user_id, balance) values('USER', actor, 0) on conflict(user_id) do nothing;
  if newcomer and inviter is not null and inviter <> actor then
    select id into inviter_account from public.energy_accounts where user_id = inviter and account_type = 'USER';
    if inviter_account is not null and exists(select 1 from public.knowledge_ball_profiles where user_id = inviter and active) then
      insert into public.energy_transactions(transaction_type, idempotency_key, metadata)
        values('REFERRAL', 'referral:' || actor::text, jsonb_build_object('inviter', inviter, 'new_user', actor))
        on conflict(idempotency_key) do nothing returning id into tx;
      if tx is not null then
        insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
          (tx, '00000000-0000-0000-0000-000000000001', -10), (tx, inviter_account, 10);
        update public.energy_accounts set balance = balance - 10 where account_type = 'SYSTEM';
        update public.energy_accounts set balance = balance + 10 where id = inviter_account;
        insert into public.referrals(inviter_user_id, new_user_id, new_user_phone_identity, reward_transaction_id)
          values(inviter, actor, normalized, tx);
      end if;
    end if;
  end if;
  perform public.assert_energy_conservation();
  return jsonb_build_object('user_id', actor, 'phone_normalized', normalized, 'is_newcomer', newcomer, 'rewarded', tx is not null);
end $$;

create or replace function public.spend_energy(amount bigint, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); user_account uuid; tx uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if amount <= 0 or nullif(operation_key, '') is null then raise exception 'invalid spend' using errcode = '22023'; end if;
  if exists(select 1 from public.energy_transactions where idempotency_key = operation_key) then
    return jsonb_build_object('idempotency_key', operation_key, 'replayed', true);
  end if;
  select id into user_account from public.energy_accounts where user_id = actor for update;
  if user_account is null then raise exception 'energy account not found'; end if;
  update public.energy_accounts set balance = balance - amount where id = user_account and balance - amount >= -10;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata)
    values('SPEND', operation_key, jsonb_build_object('user_id', actor)) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, user_account, -amount), (tx, '00000000-0000-0000-0000-000000000001', amount);
  update public.energy_accounts set balance = balance + amount where account_type = 'SYSTEM';
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', amount);
end $$;

create or replace function public.change_verified_phone(verified_phone text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); normalized text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  normalized := public.normalize_e164(verified_phone);
  if coalesce(auth.jwt()->>'phone', '') = '' or public.normalize_e164(auth.jwt()->>'phone') <> normalized then
    raise exception 'verified phone mismatch' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized, 0));
  if exists(select 1 from public.knowledge_ball_profiles where phone_normalized = normalized and active and user_id <> actor) then
    raise exception 'phone already has an active account' using errcode = '23505';
  end if;
  update public.knowledge_ball_profiles set phone_normalized = normalized where user_id = actor;
  if not found then raise exception 'profile not found'; end if;
  insert into public.phone_registration_registry(phone_normalized, first_user_id) values(normalized, actor) on conflict do nothing;
  return jsonb_build_object('user_id', actor, 'phone_normalized', normalized, 'is_newcomer', false, 'rewarded', false);
end $$;

create or replace function public.transfer_energy(recipient uuid, amount bigint, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); source_account uuid; target_account uuid; tx uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if recipient = actor or amount <= 0 or nullif(operation_key, '') is null then raise exception 'invalid transfer' using errcode = '22023'; end if;
  if exists(select 1 from public.energy_transactions where idempotency_key = operation_key) then return jsonb_build_object('idempotency_key', operation_key, 'replayed', true); end if;
  select id into source_account from public.energy_accounts where user_id = actor for update;
  select id into target_account from public.energy_accounts where user_id = recipient for update;
  if target_account is null then raise exception 'recipient not found'; end if;
  update public.energy_accounts set balance = balance - amount where id = source_account and balance - amount >= -10;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata)
    values('TRANSFER', operation_key, jsonb_build_object('from', actor, 'to', recipient)) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, source_account, -amount), (tx, target_account, amount);
  update public.energy_accounts set balance = balance + amount where id = target_account;
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', amount);
end $$;

revoke all on function public.normalize_e164(text), public.assert_energy_conservation(),
  public.register_verified_phone(text, uuid, text), public.spend_energy(bigint, text),
  public.transfer_energy(uuid, bigint, text), public.change_verified_phone(text) from public, anon;
grant execute on function public.register_verified_phone(text, uuid, text),
  public.spend_energy(bigint, text), public.transfer_energy(uuid, bigint, text),
  public.change_verified_phone(text) to authenticated;
