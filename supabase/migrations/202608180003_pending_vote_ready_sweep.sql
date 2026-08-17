-- A client-triggered sweep must handle both deadline expiry and historical/live
-- rounds that have already reached their snapshotted threshold. This is a single
-- low-frequency global sweep, never one timer per node.

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

revoke all on function public.settle_expired_pending_knowledge_votes(integer) from public,anon,authenticated;
grant execute on function public.settle_expired_pending_knowledge_votes(integer) to authenticated;
comment on function public.settle_expired_pending_knowledge_votes(integer) is
  'Low-frequency readiness sweep: finalizes threshold-ready or 720-hour-expired ORIGINAL_DESIGN_V1 rounds.';

-- Immediately repair the historical gap once this migration lands. Legacy rows
-- were never charged a creator stake, so the finalizer settles only their already
-- recorded ordinary voter stakes and emits the server verdict event.
do $$
declare item record;
begin
  for item in
    select id from public.knowledge_pending_vote_rounds
    where verdict='PENDING' and legacy_unfunded
    order by opened_at,id
  loop
    perform public.finalize_pending_vote_round(item.id);
  end loop;
end $$;

create or replace function public.knowledge_ball_schema_version() returns text
language sql security definer stable set search_path=public,pg_temp
as $$ select '202608180003'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public,anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
