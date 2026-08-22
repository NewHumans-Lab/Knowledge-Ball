-- Module 4 forward hardening after hosted advisor verification.
--
-- Revalidation changes which immutable knowledge ball can become authoritative,
-- so initiating it belongs to the same registered-account boundary as public
-- knowledge creation. Ordinary voting remains aligned with the existing policy:
-- authenticated Supabase sessions (including the current anonymous-vote policy)
-- may vote when the V1 stage eligibility rules permit it.

create index if not exists knowledge_revalidation_rounds_node
  on private.knowledge_revalidation_rounds(node_id);
create index if not exists knowledge_revalidation_rounds_initiator
  on private.knowledge_revalidation_rounds(initiator_id);
create index if not exists knowledge_revalidation_votes_voter
  on private.knowledge_revalidation_votes(voter_id);

create or replace function private.require_registered_revalidation_initiator() returns trigger
language plpgsql
security definer
set search_path = private, public, auth, pg_temp
as $$
begin
  if auth.uid() is null or new.initiator_id is distinct from auth.uid() then
    raise exception 'revalidation initiator must match authenticated user' using errcode='42501';
  end if;

  if not exists (
    select 1
    from public.knowledge_ball_profiles p
    join auth.users u on u.id=p.user_id
    where p.user_id=new.initiator_id
      and p.active
      and p.password_login_enabled
      and u.is_anonymous is false
  ) then
    raise exception '请先注册或登录账户后再发起重新验证' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.require_registered_revalidation_initiator()
from public, anon, authenticated;

drop trigger if exists require_registered_revalidation_initiator
  on private.knowledge_revalidation_rounds;
create trigger require_registered_revalidation_initiator
before insert on private.knowledge_revalidation_rounds
for each row execute function private.require_registered_revalidation_initiator();

create or replace function public.knowledge_ball_schema_version() returns text
language sql stable security definer set search_path=public,pg_temp
as $$ select '202608220002'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
