-- Public knowledge already exposes the authoritative actor_id on each event.
-- Resolve only those already-public actor ids to public presentation text without
-- reopening direct SELECT access to knowledge_ball_profiles.user_id.

create or replace function public.get_public_contributor_profiles(actor_ids uuid[])
returns table(actor_id uuid, contributor text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(cardinality(actor_ids), 0) > 100 then
    raise exception 'too many contributor ids' using errcode = '22023';
  end if;

  return query
  select
    p.user_id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(p.username), ''),
      '未命名贡献者'
    )
  from public.knowledge_ball_profiles p
  where p.active
    and p.user_id = any(coalesce(actor_ids, '{}'::uuid[]))
    and exists (
      select 1
      from public.public_knowledge_events e
      where e.actor_id = p.user_id
    );
end $$;

revoke all on function public.get_public_contributor_profiles(uuid[])
from public, anon, authenticated;
grant execute on function public.get_public_contributor_profiles(uuid[])
to anon, authenticated;

comment on function public.get_public_contributor_profiles(uuid[]) is
  'Maps actor ids already exposed by public knowledge events to active public contributor display names without granting direct profile identifier reads.';

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608210001'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
