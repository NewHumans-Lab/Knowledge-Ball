\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.public_knowledge_events (
  sequence bigint generated always as identity primary key
);

\ir ../supabase/migrations/202611020001_public_spatial_layout_snapshots.sql

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';

do $$
declare published boolean;
begin
  published := public.publish_public_spatial_snapshot(
    0, 'deterministic-5r-isg-v1', 'deadbeef',
    '[
      {"id":"ordinary-a","address":{"shellID":"shell:180.000000","cellID":2},"pos":{"x":1,"y":2,"z":3}},
      {"id":"reasoning-a","address":null,"pos":{"x":4,"y":5,"z":6}},
      {"id":"unplaced-reasoning","address":null,"pos":null}
    ]'::jsonb
  );
  if not published then raise exception 'valid current-head snapshot was not published'; end if;
  if (select count(*) from public.public_spatial_snapshots) <> 1 then
    raise exception 'snapshot row was not persisted';
  end if;
  if (select knowledge_version from public.public_spatial_snapshots where singleton) <> 0 then
    raise exception 'snapshot event-head version was not retained';
  end if;
end
$$;

do $$
begin
  begin
    perform public.publish_public_spatial_snapshot(
      0, 'deterministic-5r-isg-v1', 'deadbeef',
      '[
        {"id":"a","address":{"shellID":"shell:180.000000","cellID":2},"pos":{"x":1,"y":2,"z":3}},
        {"id":"b","address":{"shellID":"shell:180.000000","cellID":2},"pos":{"x":4,"y":5,"z":6}}
      ]'::jsonb
    );
    raise exception 'duplicate shell occupancy was accepted';
  exception when unique_violation then
    null;
  end;
end
$$;

do $$
begin
  begin
    insert into public.public_spatial_snapshots (
      singleton, knowledge_version, algorithm_version, graph_signature, snapshot, updated_by
    ) values (
      false, 0, 'deterministic-5r-isg-v1', 'deadbeef', '[]'::jsonb,
      '00000000-0000-4000-8000-000000000001'
    );
    raise exception 'direct client table writes were accepted';
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;
insert into public.public_knowledge_events default values;
set role authenticated;

do $$
declare published boolean;
begin
  published := public.publish_public_spatial_snapshot(
    0, 'deterministic-5r-isg-v1', 'deadbeef', '[]'::jsonb
  );
  if published then raise exception 'stale event-head snapshot overwrote current state'; end if;
end
$$;

reset role;
select 'spatial snapshot migration transactional, RLS, validation and stale-version tests passed' as result;
