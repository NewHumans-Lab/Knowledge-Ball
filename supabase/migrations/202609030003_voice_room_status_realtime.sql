create table if not exists public.voice_room_status (
  node_id text primary key check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  participants integer not null default 0 check (participants >= 0),
  updated_at timestamptz not null default now()
);

alter table public.voice_room_status enable row level security;
revoke all on table public.voice_room_status from anon;
grant select on table public.voice_room_status to authenticated;
grant all on table public.voice_room_status to service_role;

drop policy if exists voice_room_status_authenticated_read on public.voice_room_status;
create policy voice_room_status_authenticated_read
on public.voice_room_status
for select
to authenticated
using (true);

drop policy if exists voice_room_status_broadcast_read on realtime.messages;
create policy voice_room_status_broadcast_read
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'voice-room-status');

create or replace function public.broadcast_voice_room_status()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'nodeId', new.node_id,
      'participants', new.participants
    ),
    'voice_room_status_changed',
    'voice-room-status',
    true
  );
  return new;
end;
$$;

revoke execute on function public.broadcast_voice_room_status() from public, anon, authenticated;

drop trigger if exists broadcast_voice_room_status_trigger on public.voice_room_status;
create trigger broadcast_voice_room_status_trigger
after insert or update of participants on public.voice_room_status
for each row execute function public.broadcast_voice_room_status();
