-- Registered users may manage one public WebP avatar at avatars/{user_id}/avatar.webp.
-- Supabase anonymous sessions also use the authenticated Postgres role, so the
-- policy must additionally enforce Knowledge Ball permanent-account state.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp']::text[])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_own_avatar(target_name text) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target_name = auth.uid()::text || '/avatar.webp'
    and exists (
      select 1
      from public.knowledge_ball_profiles p
      join auth.users u on u.id = p.user_id
      where p.user_id = auth.uid()
        and p.active
        and p.password_login_enabled
        and u.is_anonymous is false
    );
$$;

revoke all on function public.can_manage_own_avatar(text) from public, anon;
grant execute on function public.can_manage_own_avatar(text) to authenticated;

drop policy if exists knowledge_ball_avatar_insert on storage.objects;
create policy knowledge_ball_avatar_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and public.can_manage_own_avatar(name)
);

drop policy if exists knowledge_ball_avatar_select_own on storage.objects;
create policy knowledge_ball_avatar_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.can_manage_own_avatar(name)
);

drop policy if exists knowledge_ball_avatar_update on storage.objects;
create policy knowledge_ball_avatar_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and public.can_manage_own_avatar(name)
)
with check (
  bucket_id = 'avatars'
  and public.can_manage_own_avatar(name)
);

comment on function public.can_manage_own_avatar(text) is
  'Allows only active, non-anonymous registered Knowledge Ball users to manage their fixed avatar object path.';
