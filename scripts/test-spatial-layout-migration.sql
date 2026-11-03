\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create schema auth;
create schema realtime;
create table realtime.messages (id bigint, topic text, extension text);
grant select, insert on realtime.messages to anon, authenticated;
create or replace function realtime.topic() returns text
language sql stable as 'select ''public-spatial-snapshot''::text';
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function realtime.send(jsonb, text, text, boolean) returns void
language plpgsql
as $$ begin return; end $$;
create table public.public_knowledge_events (
  sequence bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id)
);

\ir ../supabase/migrations/202611020001_public_spatial_layout_snapshots.sql
\ir ../supabase/migrations/20261103090000_spatial_snapshot_coordination.sql

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.public_knowledge_events(actor_id)
values ('00000000-0000-4000-8000-000000000001');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

do $$
declare
  session_id constant uuid := '10000000-0000-4000-8000-000000000001';
  lease uuid;
  published boolean;
begin
  if not public.register_public_spatial_snapshot_worker(session_id) then
    raise exception 'worker session registration failed';
  end if;
  if not public.request_public_spatial_snapshot_rebuild(session_id, 1, 'deadbeef', true) then
    raise exception 'submitter did not attach to the current rebuild job';
  end if;
  select lease_token into lease from public.claim_public_spatial_snapshot_job(session_id);
  if lease is null then raise exception 'submitter-first lease was not granted'; end if;

  published := public.publish_public_spatial_snapshot_with_lease(
    1, 'deterministic-5r-isg-v1', 'deadbeef', 'cafebabe',
    '[
      {"id":"ordinary-a","address":{"shellID":"shell:180.000000","cellID":2},"pos":{"x":1,"y":2,"z":3}},
      {"id":"reasoning-a","address":null,"pos":{"x":4,"y":5,"z":6}},
      {"id":"unplaced-reasoning","address":null,"pos":null}
    ]'::jsonb,
    session_id, lease
  );
  if not published then raise exception 'valid current-head worker snapshot was not published'; end if;
  if (select count(*) from public.public_spatial_snapshots) <> 1 then
    raise exception 'singleton snapshot row was not persisted';
  end if;
  if (select knowledge_version from public.public_spatial_snapshots where singleton) <> 1 then
    raise exception 'snapshot event-head version was not retained';
  end if;
  if (select snapshot_checksum from public.public_spatial_snapshots where singleton) <> 'cafebabe' then
    raise exception 'snapshot transfer checksum was not stored';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'kb_spatial_snapshot_broadcast_read' and cmd = 'SELECT'
      and 'authenticated' = any(roles::text[])
  ) then
    raise exception 'authenticated snapshot broadcast read policy is missing';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and cmd = 'INSERT'
      and ('authenticated' = any(roles::text[]) or 'anon' = any(roles::text[]))
  ) then
    raise exception 'client-side Realtime broadcast insertion must remain denied';
  end if;
  if has_function_privilege('authenticated',
    'public.publish_public_spatial_snapshot(bigint,text,text,jsonb)', 'execute') then
    raise exception 'legacy direct-publish RPC is still executable';
  end if;
end
$$;

do $$
begin
  begin
    insert into public.public_spatial_snapshots (
      singleton, knowledge_version, algorithm_version, graph_signature,
      snapshot_checksum, snapshot, updated_by
    ) values (
      false, 1, 'deterministic-5r-isg-v1', 'deadbeef', 'cafebabe', '[]'::jsonb,
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'direct client table writes were accepted';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
insert into public.public_knowledge_events(actor_id)
values ('00000000-0000-4000-8000-000000000001');
set role authenticated;

do $$
declare published boolean;
begin
  published := public.publish_public_spatial_snapshot_with_lease(
    1, 'deterministic-5r-isg-v1', 'deadbeef', 'cafebabe', '[]'::jsonb,
    '10000000-0000-4000-8000-000000000001', gen_random_uuid()
  );
  if published then raise exception 'stale event-head snapshot overwrote current state'; end if;
end
$$;

reset role;
select 'global spatial snapshot singleton, lease, RLS, priority and stale-version tests passed' as result;
