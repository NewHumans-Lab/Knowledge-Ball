-- Persist the final newcomer walkthrough decision on the immutable Knowledge Ball identity.
-- A final decision is intentionally one-way: once an account completed or skipped the
-- core walkthrough, no browser may reset it and make the guide auto-open again.

alter table public.knowledge_ball_profiles
  add column if not exists core_onboarding_status text;

alter table public.knowledge_ball_profiles
  drop constraint if exists knowledge_ball_profiles_core_onboarding_status_check;
alter table public.knowledge_ball_profiles
  add constraint knowledge_ball_profiles_core_onboarding_status_check
  check (core_onboarding_status is null or core_onboarding_status in ('completed', 'skipped'));

-- Every profile that exists when this feature is rolled out is already a returning
-- Knowledge Ball identity. Mark it once so that logging into that old account on a
-- brand-new device can never make it look like a newcomer. Profiles created after
-- this migration omit the column and therefore start at NULL, which is the only
-- server-side state eligible for the walkthrough.
update public.knowledge_ball_profiles
set core_onboarding_status = 'skipped'
where core_onboarding_status is null;

create or replace function public.get_my_account() returns jsonb
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with current_verdicts as (
    select distinct on (r.node_id)
      r.node_id,
      r.verdict
    from public.knowledge_pending_vote_rounds r
    where r.verdict in ('CORRECT', 'INCORRECT')
    order by r.node_id, r.round_no desc, r.closed_at desc nulls last, r.id desc
  ),
  account_positions as (
    select
      r.initiator_id as user_id,
      r.node_id,
      r.initiator_side as side
    from public.knowledge_pending_vote_rounds r
    where r.verdict in ('CORRECT', 'INCORRECT')

    union

    select
      v.voter_id as user_id,
      v.node_id,
      v.side
    from public.knowledge_pending_votes v
    join public.knowledge_pending_vote_rounds r on r.id = v.round_id
    where v.settlement_status = 'ACTIVE'
      and r.verdict in ('CORRECT', 'INCORRECT')
  ),
  accuracy_by_user as (
    select
      position.user_id,
      count(*)::bigint as attempts,
      count(*) filter (where
        (position.side = 'AGREE' and verdict.verdict = 'CORRECT')
        or (position.side = 'DISAGREE' and verdict.verdict = 'INCORRECT')
      )::bigint as wins
    from account_positions position
    join current_verdicts verdict on verdict.node_id = position.node_id
    group by position.user_id
  )
  select jsonb_build_object(
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'bio', p.bio,
    'password_login_enabled', p.password_login_enabled,
    'core_onboarding_status', p.core_onboarding_status,
    'my_balance', a.balance::text,
    'total_energy', public.current_total_energy()::text,
    'accuracy', case
      when coalesce(score.attempts, 0) = 0 then 0
      else round((100.0 * score.wins::numeric) / score.attempts::numeric, 2)
    end
  )
  from public.knowledge_ball_profiles p
  join public.energy_accounts a on a.user_id = p.user_id
  left join accuracy_by_user score on score.user_id = p.user_id
  where p.user_id = auth.uid();
$$;

create or replace function public.set_core_onboarding_status(new_status text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if new_status is null or new_status not in ('completed', 'skipped') then
    raise exception 'invalid onboarding status' using errcode = '22023';
  end if;

  update public.knowledge_ball_profiles
  set core_onboarding_status = new_status,
      updated_at = now()
  where user_id = actor
    and core_onboarding_status is null;

  if not exists (select 1 from public.knowledge_ball_profiles where user_id = actor) then
    raise exception 'profile not found';
  end if;

  return public.get_my_account();
end $$;

revoke all on function public.get_my_account() from public, anon;
revoke all on function public.set_core_onboarding_status(text) from public, anon;
grant execute on function public.get_my_account() to authenticated;
grant execute on function public.set_core_onboarding_status(text) to authenticated;

comment on column public.knowledge_ball_profiles.core_onboarding_status is
  'Permanent final state of the five-step core newcomer walkthrough; NULL means a post-rollout identity that has not dismissed it yet.';
comment on function public.set_core_onboarding_status(text) is
  'Sets the current identity core onboarding state exactly once to completed or skipped.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202609040001'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
