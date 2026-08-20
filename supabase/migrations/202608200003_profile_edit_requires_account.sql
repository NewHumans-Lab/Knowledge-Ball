-- Profile editing is a registered-account capability.
-- Anonymous participation and anonymous knowledge viewing remain allowed, but a
-- browser may not mutate profile fields until username/password recovery has been
-- successfully enabled for the immutable auth.uid().

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
    'password_login_enabled', p.password_login_enabled,
    'my_balance', a.balance::text,
    'total_energy', public.current_total_energy()::text,
    'accuracy', 0
  )
  from public.knowledge_ball_profiles p
  join public.energy_accounts a on a.user_id = p.user_id
  where p.user_id = auth.uid();
$$;

create or replace function public.update_my_profile(
  new_username text,
  new_display_name text default null,
  new_avatar_url text default null,
  new_bio text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  normalized_username text;
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.knowledge_ball_profiles p
    where p.user_id = actor
      and p.password_login_enabled
  ) then
    raise exception '请先登录账户' using errcode = '42501';
  end if;

  normalized_username := lower(trim(new_username));
  update public.knowledge_ball_profiles
  set username = normalized_username,
      display_name = nullif(trim(new_display_name), ''),
      avatar_url = nullif(trim(new_avatar_url), ''),
      bio = nullif(trim(new_bio), ''),
      updated_at = now()
  where user_id = actor;

  if not found then
    raise exception 'profile not found';
  end if;
  return public.get_my_account();
end $$;

revoke all on function public.get_my_account(),
  public.update_my_profile(text, text, text, text)
from public, anon;
grant execute on function public.get_my_account(),
  public.update_my_profile(text, text, text, text)
to authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202608200003'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;
