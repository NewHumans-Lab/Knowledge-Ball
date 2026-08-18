-- Total-energy semantic correction.
--
-- Every energy account, including the Knowledge Ball SYSTEM account, belongs to
-- one zero-sum conservation system. Let balances be b_i. The product-level
-- "总能量" value is the positive side of that conserved system:
--
--   s = sum(max(b_i, 0)) = -sum(min(b_i, 0))
--
-- The equality of the two sides is guaranteed by the existing conservation
-- invariant sum(b_i) = 0. SYSTEM is intentionally not special-cased out of the
-- calculation: if its balance is positive it contributes to s; if negative it
-- contributes to the matching negative side.
--
-- s is derived from authoritative account balances rather than persisted in a
-- second table, avoiding a denormalized global-total value that could drift from
-- the ledger during retries, settlements, or future transaction types.

create or replace function public.current_total_energy() returns numeric(30,6)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    sum(case when balance > 0.000000 then balance else 0.000000 end),
    0.000000
  )::numeric(30,6)
  from public.energy_accounts;
$$;

comment on function public.current_total_energy() is
  'Derived global total energy s: sum of every positive energy_accounts balance, including SYSTEM; conservation implies the negative side sums to -s.';

-- This is an internal accounting projection. Browser roles receive the value
-- only through get_my_account(), not through a second directly callable API.
revoke all on function public.current_total_energy() from public, anon, authenticated;

create or replace function public.get_my_account() returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'my_balance', a.balance::text,
    'total_energy', public.current_total_energy()::text,
    'accuracy', 0
  )
  from public.knowledge_ball_profiles p
  join public.energy_accounts a on a.user_id = p.user_id
  where p.user_id = auth.uid();
$$;

-- Preserve the existing browser API boundary after replacing the function.
revoke all on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated;
