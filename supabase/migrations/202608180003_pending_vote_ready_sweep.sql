-- Transitional readiness sweep. The final public grant is deliberately deferred
-- to 202608180004, which upgrades the still-unpublished first-round policy to
-- ORIGINAL_DESIGN_V2 before any historical timeout repair is allowed to run.

create or replace function public.settle_expired_pending_knowledge_votes(max_rounds integer default 50) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare item record; processed integer := 0; final_verdict text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  if max_rounds < 1 or max_rounds > 200 then raise exception 'invalid max_rounds' using errcode='22023'; end if;
  for item in
    select r.id
    from public.knowledge_pending_vote_rounds r
    where r.verdict='PENDING' and (
      r.deadline<=now()
      or (select count(*) from public.knowledge_pending_votes v where v.round_id=r.id and v.side='AGREE') >= r.required_votes
      or (select count(*) from public.knowledge_pending_votes v where v.round_id=r.id and v.side='DISAGREE') >= r.required_votes
    )
    order by r.deadline,r.id
    limit max_rounds
  loop
    perform public.finalize_pending_vote_round(item.id);
    select verdict into final_verdict from public.knowledge_pending_vote_rounds where id=item.id;
    if final_verdict <> 'PENDING' then processed := processed + 1; end if;
  end loop;
  return processed;
end $$;

-- Safety gate for staged hosted deployment: the V1 finalizer created by the two
-- preceding repository migrations must not be reachable by browser clients in
-- the interval before 202608180004 replaces it with V2 semantics.
revoke all on function public.settle_expired_pending_knowledge_votes(integer) from public,anon,authenticated;
revoke execute on function public.get_pending_knowledge_vote(text) from authenticated;
revoke execute on function public.cast_pending_knowledge_vote(text,text,text) from authenticated;
comment on function public.settle_expired_pending_knowledge_votes(integer) is
  'Transitional internal sweep; browser execution is enabled only after ORIGINAL_DESIGN_V2 is installed.';

-- Historical settlement is intentionally deferred to 202608180004, which first
-- installs V2, normalizes impossible historical ballots, and then repairs rounds.

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180003'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
