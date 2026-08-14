-- Issue #42 forward-only cleanup. Preserve historical rows, disable every phone/referral path.
revoke all on function public.register_verified_phone(text, uuid, text), public.change_verified_phone(text),
  public.normalize_e164(text) from public, anon, authenticated;
drop function public.register_verified_phone(text, uuid, text);
drop function public.change_verified_phone(text);
drop function public.normalize_e164(text);

drop index if exists public.one_active_account_per_phone;
alter table public.knowledge_ball_profiles alter column phone_normalized drop not null;
alter table public.knowledge_ball_profiles drop constraint if exists knowledge_ball_profiles_phone_normalized_check;
alter table public.knowledge_ball_profiles rename column phone_normalized to legacy_phone_normalized;
alter table public.phone_registration_registry rename to legacy_phone_registration_registry;
alter table public.referrals rename to legacy_phone_referrals;
revoke all on public.legacy_phone_registration_registry, public.legacy_phone_referrals from public, anon, authenticated;
comment on table public.legacy_phone_registration_registry is 'Historical data only. Phone registration was removed by issue #42.';
comment on table public.legacy_phone_referrals is 'Historical accounting evidence only. Referral generation was removed by issue #42.';

create or replace function public.ensure_anonymous_profile() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid := auth.uid(); generated_handle text;
begin
  if actor is null then raise exception 'anonymous authentication session required' using errcode = '42501'; end if;
  generated_handle := 'guest_' || left(replace(actor::text, '-', ''), 12);
  insert into public.knowledge_ball_profiles(user_id, legacy_phone_normalized, active, username)
    values(actor, null, true, generated_handle) on conflict(user_id) do nothing;
  insert into public.energy_accounts(account_type, user_id, balance)
    values('USER', actor, 0.000000) on conflict(user_id) do nothing;
  return public.get_my_account();
end $$;

revoke all on function public.ensure_anonymous_profile() from public, anon;
grant execute on function public.ensure_anonymous_profile() to authenticated;

-- Anonymous Supabase users use auth.uid() and the same validated append RPC as every participant.
grant execute on function public.append_public_knowledge_events(bigint, jsonb) to authenticated;

