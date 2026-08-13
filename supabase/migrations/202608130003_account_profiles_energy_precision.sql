-- Issue #38: extend the existing verified-phone identity and ledger in place.
create sequence if not exists public.knowledge_ball_account_no_seq as bigint;

alter table public.knowledge_ball_profiles
  add column if not exists account_no bigint,
  add column if not exists username text,
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists updated_at timestamptz not null default now();

update public.knowledge_ball_profiles
set account_no = nextval('public.knowledge_ball_account_no_seq')
where account_no is null;
alter table public.knowledge_ball_profiles alter column account_no set not null;
alter table public.knowledge_ball_profiles alter column account_no set default nextval('public.knowledge_ball_account_no_seq');
alter table public.knowledge_ball_profiles add constraint knowledge_ball_profiles_account_no_key unique(account_no);
alter table public.knowledge_ball_profiles add constraint valid_username
  check (username is null or username ~ '^[a-z0-9_]{3,24}$');
alter table public.knowledge_ball_profiles add constraint valid_display_name
  check (display_name is null or char_length(display_name) between 1 and 60);
alter table public.knowledge_ball_profiles add constraint valid_avatar_url
  check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://'));
alter table public.knowledge_ball_profiles add constraint valid_bio
  check (bio is null or char_length(bio) <= 280);
create unique index knowledge_ball_profiles_username_ci
  on public.knowledge_ball_profiles(lower(username)) where username is not null;

-- NUMERIC is authoritative: six decimal places, never IEEE-754 floating point.
alter table public.energy_accounts drop constraint if exists energy_accounts_check;
alter table public.energy_accounts alter column balance type numeric(30,6) using balance::numeric(30,6);
alter table public.energy_accounts add constraint energy_account_floor check (
  (account_type = 'USER' and user_id is not null and balance >= -10.000000)
  or (account_type = 'SYSTEM' and user_id is null)
);
alter table public.energy_ledger_entries alter column amount type numeric(30,6) using amount::numeric(30,6);

create or replace function public.prevent_permanent_identity_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id <> old.user_id or new.account_no <> old.account_no then
    raise exception 'permanent identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger permanent_profile_identity before update on public.knowledge_ball_profiles
for each row execute function public.prevent_permanent_identity_change();

-- Only non-secret public profile fields are readable. Phone and identity audit fields stay private.
create policy "owner reads own complete profile" on public.knowledge_ball_profiles
  for select to authenticated using (user_id = auth.uid());
create policy "public reads active profile fields" on public.knowledge_ball_profiles
  for select to anon, authenticated using (active);
revoke all on public.knowledge_ball_profiles from anon, authenticated;
grant select(username, display_name, avatar_url, bio, created_at, updated_at)
  on public.knowledge_ball_profiles to anon, authenticated;
grant select(user_id, account_no, active) on public.knowledge_ball_profiles to authenticated;

create or replace function public.get_my_account() returns jsonb
language sql security definer stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'bio', p.bio, 'my_balance', a.balance::text,
    'total_energy', (select coalesce(sum(balance), 0)::text from public.energy_accounts where account_type = 'USER'),
    'accuracy', 0
  ) from public.knowledge_ball_profiles p
  join public.energy_accounts a on a.user_id = p.user_id
  where p.user_id = auth.uid();
$$;

create or replace function public.update_my_profile(
  new_username text, new_display_name text default null, new_avatar_url text default null, new_bio text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); normalized_username text;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  normalized_username := lower(trim(new_username));
  update public.knowledge_ball_profiles set
    username = normalized_username,
    display_name = nullif(trim(new_display_name), ''),
    avatar_url = nullif(trim(new_avatar_url), ''),
    bio = nullif(trim(new_bio), ''),
    updated_at = now()
  where user_id = actor;
  if not found then raise exception 'profile not found'; end if;
  return public.get_my_account();
end $$;

create or replace function public.validate_energy_amount(amount numeric) returns numeric
language plpgsql immutable strict set search_path = public, pg_temp as $$
begin
  if amount <= 0 or amount <> round(amount, 6) then
    raise exception 'energy amount must be positive with at most six decimals' using errcode = '22023';
  end if;
  return amount::numeric(30,6);
end $$;

create or replace function public.spend_energy(amount numeric, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); user_account uuid; tx uuid; exact_amount numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  exact_amount := public.validate_energy_amount(amount);
  if nullif(operation_key, '') is null then raise exception 'idempotency key required' using errcode = '22023'; end if;
  if exists(select 1 from public.energy_transactions where idempotency_key = operation_key) then return jsonb_build_object('replayed', true); end if;
  select id into user_account from public.energy_accounts where user_id = actor for update;
  update public.energy_accounts set balance = balance - exact_amount where id = user_account and balance - exact_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata)
    values('SPEND', operation_key, jsonb_build_object('user_id', actor)) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, user_account, -exact_amount), (tx, '00000000-0000-0000-0000-000000000001', exact_amount);
  update public.energy_accounts set balance = balance + exact_amount where account_type = 'SYSTEM';
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', exact_amount::text);
end $$;

create or replace function public.transfer_energy(recipient uuid, amount numeric, operation_key text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); source_account uuid; target_account uuid; tx uuid; exact_amount numeric(30,6);
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  exact_amount := public.validate_energy_amount(amount);
  if recipient = actor or nullif(operation_key, '') is null then raise exception 'invalid transfer' using errcode = '22023'; end if;
  if exists(select 1 from public.energy_transactions where idempotency_key = operation_key) then return jsonb_build_object('replayed', true); end if;
  select id into source_account from public.energy_accounts where user_id = actor for update;
  select id into target_account from public.energy_accounts where user_id = recipient for update;
  if target_account is null then raise exception 'recipient not found'; end if;
  update public.energy_accounts set balance = balance - exact_amount where id = source_account and balance - exact_amount >= -10.000000;
  if not found then raise exception 'insufficient energy' using errcode = '23514'; end if;
  insert into public.energy_transactions(transaction_type, idempotency_key, metadata)
    values('TRANSFER', operation_key, jsonb_build_object('from', actor, 'to', recipient)) returning id into tx;
  insert into public.energy_ledger_entries(transaction_id, account_id, amount) values
    (tx, source_account, -exact_amount), (tx, target_account, exact_amount);
  update public.energy_accounts set balance = balance + exact_amount where id = target_account;
  perform public.assert_energy_conservation();
  return jsonb_build_object('transaction_id', tx, 'amount', exact_amount::text);
end $$;

-- Internal diagnostics remain callable by trusted definer functions, not browser roles.
revoke all on function public.assert_energy_conservation() from public, anon, authenticated;
revoke all on function public.get_my_account(), public.update_my_profile(text, text, text, text),
  public.validate_energy_amount(numeric) from public, anon;
grant execute on function public.get_my_account(), public.update_my_profile(text, text, text, text) to authenticated;
revoke all on function public.spend_energy(numeric, text), public.transfer_energy(uuid, numeric, text) from public, anon;
grant execute on function public.spend_energy(numeric, text), public.transfer_energy(uuid, numeric, text) to authenticated;
