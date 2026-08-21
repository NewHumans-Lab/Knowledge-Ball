-- Restore account accuracy from the frozen truth-policy position semantics.
--
-- One attempt is one unique (claim version/node, side) position owned by the
-- account. Creator positions and valid ordinary-vote positions participate in
-- the same set, so repeated positions on the same side never inflate accuracy
-- while AGREE and DISAGREE on the same claim can each count once.
--
-- A position becomes scorable only after its own verification round has a final
-- verdict. PENDING verification therefore never enters the denominator. Invalid
-- historical ballots that were voided/refunded are not positions and are ignored.

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

revoke all on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated;

comment on function public.get_my_account() is
  'Returns the authenticated account with accuracy derived from unique finalized claim-side positions; pending verification and void historical ballots are excluded.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608210002'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
