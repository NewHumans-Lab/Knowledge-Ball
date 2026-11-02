-- Persist the exact output of the existing deterministic 5R / icosahedral
-- layout. This is a disposable cache, never a source of knowledge truth.
create table public.public_spatial_snapshots (
  singleton boolean primary key default true check (singleton is true),
  knowledge_version bigint not null check (knowledge_version >= 0),
  algorithm_version text not null,
  graph_signature text not null check (graph_signature ~ '^[0-9a-f]{8}$'),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot) = 'array'
    and octet_length(snapshot::text) <= 8388608
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);

alter table public.public_spatial_snapshots enable row level security;
create policy "authenticated users read public spatial snapshot"
  on public.public_spatial_snapshots
  for select to authenticated
  using (true);

revoke all on public.public_spatial_snapshots from public, anon, authenticated;
grant select on public.public_spatial_snapshots to authenticated;

create or replace function public.publish_public_spatial_snapshot(
  expected_knowledge_version bigint,
  algorithm_version text,
  graph_signature text,
  snapshot_data jsonb
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  current_head bigint;
  item jsonb;
  item_id text;
  item_position jsonb;
  item_address jsonb;
  shell_id text;
  cell_id numeric;
  node_ids text[] := '{}';
  address_keys text[] := '{}';
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if expected_knowledge_version is null or expected_knowledge_version < 0
    or algorithm_version <> 'deterministic-5r-isg-v1'
    or graph_signature is null
    or graph_signature !~ '^[0-9a-f]{8}$'
    or jsonb_typeof(snapshot_data) <> 'array'
    or jsonb_array_length(snapshot_data) > 200000
    or octet_length(snapshot_data::text) > 8388608 then
    raise exception 'invalid spatial snapshot envelope' using errcode = '22023';
  end if;

  -- Validate the whole cache before taking the short publication lock.
  for item in select value from jsonb_array_elements(snapshot_data) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'invalid spatial snapshot node' using errcode = '22023';
    end if;
    item_id := item ->> 'id';
    if item_id is null or btrim(item_id) = '' or item_id = any(node_ids) then
      raise exception 'spatial snapshot node IDs must be unique and non-empty' using errcode = '23505';
    end if;
    node_ids := array_append(node_ids, item_id);

    item_position := item -> 'pos';
    item_address := item -> 'address';
    if item_position is not null and item_position <> 'null'::jsonb then
      if jsonb_typeof(item_position) <> 'object'
        or jsonb_typeof(item_position -> 'x') <> 'number'
        or jsonb_typeof(item_position -> 'y') <> 'number'
        or jsonb_typeof(item_position -> 'z') <> 'number'
        or abs((item_position ->> 'x')::numeric) > 1000000000
        or abs((item_position ->> 'y')::numeric) > 1000000000
        or abs((item_position ->> 'z')::numeric) > 1000000000 then
        raise exception 'invalid spatial snapshot position' using errcode = '22023';
      end if;
    elsif item_address is not null and item_address <> 'null'::jsonb then
      raise exception 'a spatial address requires a position' using errcode = '22023';
    end if;

    if item_address is not null and item_address <> 'null'::jsonb then
      if jsonb_typeof(item_address) <> 'object'
        or jsonb_typeof(item_address -> 'shellID') <> 'string'
        or nullif(item_address ->> 'shellID', '') is null
        or jsonb_typeof(item_address -> 'cellID') <> 'number' then
        raise exception 'invalid spatial snapshot address' using errcode = '22023';
      end if;
      cell_id := (item_address ->> 'cellID')::numeric;
      if cell_id < 0 or cell_id <> trunc(cell_id) then
        raise exception 'invalid spatial snapshot cell ID' using errcode = '22023';
      end if;
      shell_id := item_address ->> 'shellID';
      if (shell_id || ':' || cell_id::text) = any(address_keys) then
        raise exception 'spatial snapshot contains duplicate shell occupancy' using errcode = '23505';
      end if;
      address_keys := array_append(address_keys, shell_id || ':' || cell_id::text);
    end if;
  end loop;

  -- Same transaction lock as append_public_knowledge_events. Browser-side
  -- layout calculation happens outside the transaction and never blocks writes.
  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence), 0) into current_head
  from public.public_knowledge_events;
  if current_head <> expected_knowledge_version then
    return false;
  end if;

  insert into public.public_spatial_snapshots (
    singleton, knowledge_version, algorithm_version, graph_signature, snapshot, updated_by
  ) values (
    true, expected_knowledge_version, algorithm_version, graph_signature, snapshot_data, actor
  )
  on conflict (singleton) do update
    set knowledge_version = excluded.knowledge_version,
        algorithm_version = excluded.algorithm_version,
        graph_signature = excluded.graph_signature,
        snapshot = excluded.snapshot,
        updated_at = now(),
        updated_by = excluded.updated_by
    where public.public_spatial_snapshots.knowledge_version < excluded.knowledge_version
      or public.public_spatial_snapshots.algorithm_version <> excluded.algorithm_version;

  return found;
end;
$$;

revoke all on function public.publish_public_spatial_snapshot(bigint, text, text, jsonb) from public, anon;
grant execute on function public.publish_public_spatial_snapshot(bigint, text, text, jsonb) to authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '202611020001'::text $$;

revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;

comment on table public.public_spatial_snapshots is
  'Versioned disposable cache of deterministic 5R / icosahedral node positions; public knowledge events remain authoritative.';
comment on function public.publish_public_spatial_snapshot(bigint, text, text, jsonb) is
  'Atomically publishes a complete spatial cache only when its event-head version still matches the public event stream.';
