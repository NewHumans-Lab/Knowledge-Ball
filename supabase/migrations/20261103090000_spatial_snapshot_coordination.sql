-- Global singleton spatial snapshot coordination.
-- The snapshot remains a disposable cache; public_knowledge_events stays authoritative.

alter table public.public_spatial_snapshots
  add column if not exists snapshot_checksum text not null default '00000000'
  check (snapshot_checksum ~ '^[0-9a-f]{8}$');

create table if not exists public.public_spatial_snapshot_workers (
  session_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp()
);
alter table public.public_spatial_snapshot_workers enable row level security;
revoke all on public.public_spatial_snapshot_workers from public, anon, authenticated;

create table if not exists public.public_spatial_snapshot_jobs (
  singleton boolean primary key default true check (singleton is true),
  desired_knowledge_version bigint not null check (desired_knowledge_version >= 0),
  desired_graph_signature text check (desired_graph_signature is null or desired_graph_signature ~ '^[0-9a-f]{8}$'),
  requested_by uuid references auth.users(id),
  requester_session_id uuid,
  requested_at timestamptz not null default clock_timestamp(),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete')),
  lease_session_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (status = 'running' and lease_session_id is not null and lease_token is not null and lease_expires_at is not null)
    or
    (status <> 'running' and lease_session_id is null and lease_token is null and lease_expires_at is null)
  )
);
alter table public.public_spatial_snapshot_jobs enable row level security;
revoke all on public.public_spatial_snapshot_jobs from public, anon, authenticated;

-- A single mutable queue row: new event versions supersede the unfinished target.
create or replace function public.enqueue_public_spatial_snapshot_rebuild()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(1729364207);
  insert into public.public_spatial_snapshot_jobs (
    singleton, desired_knowledge_version, desired_graph_signature, requested_by,
    requester_session_id, requested_at, status, lease_session_id, lease_token,
    lease_expires_at, attempt_count, updated_at
  ) values (
    true, new.sequence, null, new.actor_id, null, clock_timestamp(), 'pending',
    null, null, null, 0, clock_timestamp()
  )
  on conflict (singleton) do update
    set desired_knowledge_version = excluded.desired_knowledge_version,
        desired_graph_signature = null,
        requested_by = excluded.requested_by,
        requester_session_id = null,
        requested_at = excluded.requested_at,
        status = 'pending',
        lease_session_id = null,
        lease_token = null,
        lease_expires_at = null,
        attempt_count = 0,
        updated_at = clock_timestamp()
    where public.public_spatial_snapshot_jobs.desired_knowledge_version < excluded.desired_knowledge_version;

  perform realtime.send(
    jsonb_build_object('knowledgeVersion', new.sequence::text),
    'spatial_snapshot_rebuild_requested',
    'public-spatial-snapshot',
    false
  );
  return new;
end;
$$;
revoke all on function public.enqueue_public_spatial_snapshot_rebuild() from public, anon, authenticated;

drop trigger if exists public_spatial_snapshot_rebuild_requested on public.public_knowledge_events;
create trigger public_spatial_snapshot_rebuild_requested
after insert on public.public_knowledge_events
for each row execute function public.enqueue_public_spatial_snapshot_rebuild();

create or replace function public.register_public_spatial_snapshot_worker(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or p_session_id is null then
    raise exception 'authenticated worker session required' using errcode = '42501';
  end if;
  delete from public.public_spatial_snapshot_workers
  where last_seen_at < clock_timestamp() - interval '1 day';
  insert into public.public_spatial_snapshot_workers(session_id, actor_id)
  values (p_session_id, actor)
  on conflict (session_id) do update
    set last_seen_at = clock_timestamp()
    where public.public_spatial_snapshot_workers.actor_id = excluded.actor_id;
  if not found then
    raise exception 'worker session belongs to another account' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.heartbeat_public_spatial_snapshot_worker(
  p_session_id uuid,
  p_lease_token uuid default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  insert into public.public_spatial_snapshot_workers(session_id, actor_id)
    values (p_session_id, actor)
    on conflict (session_id) do update
      set last_seen_at = clock_timestamp()
      where public.public_spatial_snapshot_workers.actor_id = excluded.actor_id;
  if not found then
    raise exception 'worker session belongs to another account' using errcode = '42501';
  end if;

  if p_lease_token is not null then
    update public.public_spatial_snapshot_jobs
      set lease_expires_at = clock_timestamp() + interval '3 minutes',
          updated_at = clock_timestamp()
      where singleton is true and status = 'running'
        and lease_session_id = p_session_id and lease_token = p_lease_token
        and lease_expires_at > clock_timestamp();
  end if;

  -- Any live browser can recover a job whose owner disappeared before publish.
  update public.public_spatial_snapshot_jobs
    set status = 'pending',
        lease_session_id = null,
        lease_token = null,
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where singleton is true and status = 'running'
      and lease_expires_at <= clock_timestamp();
  if found then
    perform realtime.send(
      jsonb_build_object(
        'knowledgeVersion',
        (select desired_knowledge_version::text from public.public_spatial_snapshot_jobs where singleton is true)
      ),
      'spatial_snapshot_rebuild_requested',
      'public-spatial-snapshot',
      false
    );
  end if;
  return true;
end;
$$;

create or replace function public.request_public_spatial_snapshot_rebuild(
  p_session_id uuid,
  p_knowledge_version bigint,
  p_graph_signature text,
  p_submitted boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  current_head bigint;
  latest_actor uuid;
  current_snapshot public.public_spatial_snapshots%rowtype;
  current_job public.public_spatial_snapshot_jobs%rowtype;
  should_broadcast boolean := false;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_session_id is null or p_knowledge_version is null or p_knowledge_version < 0
     or p_graph_signature !~ '^[0-9a-f]{8}$' then
    raise exception 'invalid spatial snapshot rebuild request' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.public_spatial_snapshot_workers
    where session_id = p_session_id and actor_id = actor
      and last_seen_at > clock_timestamp() - interval '3 minutes'
  ) then
    raise exception 'worker session is not registered or has expired' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence), 0) into current_head from public.public_knowledge_events;
  if current_head <> p_knowledge_version then return false; end if;

  if p_submitted then
    select actor_id into latest_actor from public.public_knowledge_events
    where sequence = p_knowledge_version;
    if latest_actor is distinct from actor then
      raise exception 'submitter session must own the latest accepted knowledge event' using errcode = '42501';
    end if;
  end if;

  select * into current_snapshot
  from public.public_spatial_snapshots where singleton is true;
  if found
    and current_snapshot.knowledge_version = p_knowledge_version
    and current_snapshot.algorithm_version = 'deterministic-5r-isg-v1'
    and current_snapshot.graph_signature = p_graph_signature then
    update public.public_spatial_snapshot_jobs
      set status = 'complete', desired_graph_signature = p_graph_signature,
          lease_session_id = null, lease_token = null, lease_expires_at = null,
          updated_at = clock_timestamp()
      where singleton is true
        and desired_knowledge_version = p_knowledge_version
        and status <> 'complete';
    return false;
  end if;

  select * into current_job
  from public.public_spatial_snapshot_jobs where singleton is true
  for update;

  if not found then
    insert into public.public_spatial_snapshot_jobs (
      singleton, desired_knowledge_version, desired_graph_signature, requested_by,
      requester_session_id, requested_at, status
    ) values (
      true, p_knowledge_version, p_graph_signature, actor,
      case when p_submitted then p_session_id else null end,
      clock_timestamp(), 'pending'
    );
    should_broadcast := true;
  elsif current_job.desired_knowledge_version > p_knowledge_version then
    return false;
  elsif current_job.desired_knowledge_version < p_knowledge_version then
    update public.public_spatial_snapshot_jobs
      set desired_knowledge_version = p_knowledge_version,
          desired_graph_signature = p_graph_signature,
          requested_by = actor,
          requester_session_id = case when p_submitted then p_session_id else null end,
          requested_at = clock_timestamp(),
          status = 'pending',
          lease_session_id = null,
          lease_token = null,
          lease_expires_at = null,
          attempt_count = 0,
          updated_at = clock_timestamp()
      where singleton is true;
    should_broadcast := true;
  else
    if current_job.desired_graph_signature is not null
       and current_job.desired_graph_signature <> p_graph_signature then
      if current_job.status = 'complete' then
        update public.public_spatial_snapshot_jobs
          set desired_graph_signature = p_graph_signature,
              requested_by = actor,
              requester_session_id = case when p_submitted then p_session_id else null end,
              requested_at = clock_timestamp(),
              status = 'pending',
              lease_session_id = null,
              lease_token = null,
              lease_expires_at = null,
              attempt_count = 0,
              updated_at = clock_timestamp()
          where singleton is true;
        should_broadcast := true;
      else
        return false;
      end if;
    else
      if current_job.desired_graph_signature is null or current_job.status = 'complete' then
        should_broadcast := true;
      end if;
      update public.public_spatial_snapshot_jobs
        set desired_graph_signature = coalesce(desired_graph_signature, p_graph_signature),
            requester_session_id = case when p_submitted then p_session_id else requester_session_id end,
            requested_by = case when p_submitted then actor else requested_by end,
            status = case
              when p_submitted and status = 'running' and lease_session_id <> p_session_id then 'pending'
              when status = 'complete' then 'pending'
              else status
            end,
            lease_session_id = case
              when p_submitted and status = 'running' and lease_session_id <> p_session_id then null
              else lease_session_id
            end,
            lease_token = case
              when p_submitted and status = 'running' and lease_session_id <> p_session_id then null
              else lease_token
            end,
            lease_expires_at = case
              when p_submitted and status = 'running' and lease_session_id <> p_session_id then null
              else lease_expires_at
            end,
            updated_at = clock_timestamp()
        where singleton is true;
    end if;
  end if;

  if should_broadcast or p_submitted then
    perform realtime.send(
      jsonb_build_object('knowledgeVersion', p_knowledge_version::text),
      'spatial_snapshot_rebuild_requested',
      'public-spatial-snapshot',
      false
    );
  end if;
  return true;
end;
$$;

create or replace function public.claim_public_spatial_snapshot_job(p_session_id uuid)
returns table (
  knowledge_version bigint,
  graph_signature text,
  lease_token uuid,
  lease_expires_at timestamptz,
  priority integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  worker public.public_spatial_snapshot_workers%rowtype;
  job public.public_spatial_snapshot_jobs%rowtype;
  existing_snapshot public.public_spatial_snapshots%rowtype;
  new_token uuid;
  new_expiry timestamptz;
  worker_priority integer;
  has_preexisting_online boolean;
begin
  if actor is null or p_session_id is null then
    raise exception 'authenticated worker session required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(1729364207);
  select * into worker
  from public.public_spatial_snapshot_workers
  where session_id = p_session_id and actor_id = actor
    and last_seen_at > clock_timestamp() - interval '3 minutes'
  for update;
  if not found then
    raise exception 'worker session is not registered or has expired' using errcode = '42501';
  end if;

  select * into job from public.public_spatial_snapshot_jobs
  where singleton is true for update;
  if not found then return; end if;

  select * into existing_snapshot
  from public.public_spatial_snapshots where singleton is true;
  if found
    and existing_snapshot.knowledge_version = job.desired_knowledge_version
    and existing_snapshot.algorithm_version = 'deterministic-5r-isg-v1'
    and (job.desired_graph_signature is null
      or existing_snapshot.graph_signature = job.desired_graph_signature) then
    update public.public_spatial_snapshot_jobs
      set status = 'complete', lease_session_id = null, lease_token = null,
          lease_expires_at = null, updated_at = clock_timestamp()
      where singleton is true;
    return;
  end if;

  if job.status = 'running' and job.lease_expires_at > clock_timestamp() then
    if job.lease_session_id = p_session_id then
      return query select job.desired_knowledge_version, job.desired_graph_signature,
        job.lease_token, job.lease_expires_at, 1;
    end if;
    return;
  end if;

  if job.requester_session_id = p_session_id then
    worker_priority := 1;
  elsif worker.started_at <= job.requested_at then
    worker_priority := 2;
  else
    worker_priority := 3;
  end if;

  select exists (
    select 1 from public.public_spatial_snapshot_workers online
    where online.started_at <= job.requested_at
      and online.last_seen_at > clock_timestamp() - interval '3 minutes'
      and online.session_id <> p_session_id
  ) into has_preexisting_online;

  if worker_priority = 2 and clock_timestamp() < job.requested_at + interval '2 seconds' then
    return;
  end if;
  if worker_priority = 3 and has_preexisting_online
     and clock_timestamp() < job.requested_at + interval '20 seconds' then
    return;
  end if;

  new_token := gen_random_uuid();
  new_expiry := clock_timestamp() + interval '3 minutes';
  update public.public_spatial_snapshot_jobs
    set status = 'running',
        lease_session_id = p_session_id,
        lease_token = new_token,
        lease_expires_at = new_expiry,
        attempt_count = attempt_count + 1,
        updated_at = clock_timestamp()
    where singleton is true;

  return query select job.desired_knowledge_version, job.desired_graph_signature,
    new_token, new_expiry, worker_priority;
end;
$$;

create or replace function public.release_public_spatial_snapshot_job(
  p_session_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  changed integer;
  target_version bigint;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.public_spatial_snapshot_workers
    where session_id = p_session_id and actor_id = actor
  ) then
    raise exception 'worker session ownership mismatch' using errcode = '42501';
  end if;
  update public.public_spatial_snapshot_jobs
    set status = 'pending',
        lease_session_id = null,
        lease_token = null,
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where singleton is true and status = 'running'
      and lease_session_id = p_session_id and lease_token = p_lease_token;
  get diagnostics changed = row_count;
  if changed > 0 then
    select desired_knowledge_version into target_version
    from public.public_spatial_snapshot_jobs where singleton is true;
    perform realtime.send(
      jsonb_build_object('knowledgeVersion', target_version::text),
      'spatial_snapshot_rebuild_requested',
      'public-spatial-snapshot',
      false
    );
  end if;
  return changed > 0;
end;
$$;

create or replace function public.publish_public_spatial_snapshot_with_lease(
  p_knowledge_version bigint,
  p_algorithm_version text,
  p_graph_signature text,
  p_snapshot_checksum text,
  p_snapshot_data jsonb,
  p_session_id uuid,
  p_lease_token uuid
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  current_head bigint;
  job public.public_spatial_snapshot_jobs%rowtype;
  item jsonb;
  item_id text;
  position_data jsonb;
  address_data jsonb;
  shell_id text;
  cell_id numeric;
  node_count integer;
  distinct_node_count integer;
  address_count integer;
  distinct_address_count integer;
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_knowledge_version is null or p_knowledge_version < 0
    or p_algorithm_version <> 'deterministic-5r-isg-v1'
    or p_graph_signature is null or p_graph_signature !~ '^[0-9a-f]{8}$'
    or p_snapshot_checksum is null or p_snapshot_checksum !~ '^[0-9a-f]{8}$'
    or jsonb_typeof(p_snapshot_data) <> 'array'
    or jsonb_array_length(p_snapshot_data) > 200000
    or octet_length(p_snapshot_data::text) > 8388608 then
    raise exception 'invalid spatial snapshot envelope' using errcode = '22023';
  end if;

  select count(*), count(distinct value ->> 'id')
    into node_count, distinct_node_count
    from jsonb_array_elements(p_snapshot_data);
  if node_count <> distinct_node_count then
    raise exception 'spatial snapshot node IDs must be unique and non-empty' using errcode = '23505';
  end if;
  select count(*), count(distinct ((value -> 'address' ->> 'shellID') || ':' || (value -> 'address' ->> 'cellID')))
    into address_count, distinct_address_count
    from jsonb_array_elements(p_snapshot_data)
    where value -> 'address' is not null and value -> 'address' <> 'null'::jsonb;
  if address_count <> distinct_address_count then
    raise exception 'spatial snapshot contains duplicate shell occupancy' using errcode = '23505';
  end if;

  for item in select value from jsonb_array_elements(p_snapshot_data) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'invalid spatial snapshot node' using errcode = '22023';
    end if;
    item_id := item ->> 'id';
    if item_id is null or btrim(item_id) = '' or char_length(item_id) > 200 then
      raise exception 'invalid spatial snapshot node ID' using errcode = '22023';
    end if;

    position_data := item -> 'pos';
    address_data := item -> 'address';
    if position_data is not null and position_data <> 'null'::jsonb then
      if jsonb_typeof(position_data) <> 'object'
        or jsonb_typeof(position_data -> 'x') <> 'number'
        or jsonb_typeof(position_data -> 'y') <> 'number'
        or jsonb_typeof(position_data -> 'z') <> 'number'
        or abs((position_data ->> 'x')::numeric) > 1000000000
        or abs((position_data ->> 'y')::numeric) > 1000000000
        or abs((position_data ->> 'z')::numeric) > 1000000000 then
        raise exception 'invalid spatial snapshot position' using errcode = '22023';
      end if;
    elsif address_data is not null and address_data <> 'null'::jsonb then
      raise exception 'a spatial address requires a position' using errcode = '22023';
    end if;

    if address_data is not null and address_data <> 'null'::jsonb then
      if jsonb_typeof(address_data) <> 'object'
        or jsonb_typeof(address_data -> 'shellID') <> 'string'
        or nullif(address_data ->> 'shellID', '') is null
        or (address_data ->> 'shellID') !~ '^shell:[0-9]+[.][0-9]{6}$'
        or jsonb_typeof(address_data -> 'cellID') <> 'number' then
        raise exception 'invalid spatial snapshot address' using errcode = '22023';
      end if;
      cell_id := (address_data ->> 'cellID')::numeric;
      if cell_id < 0 or cell_id > 9007199254740991 or cell_id <> trunc(cell_id) then
        raise exception 'invalid spatial snapshot cell ID' using errcode = '22023';
      end if;
      shell_id := address_data ->> 'shellID';
    end if;
  end loop;

  -- Acquire the event-stream lock before the singleton job row lock. This is
  -- the same order used by append_public_knowledge_events and its trigger.
  perform pg_advisory_xact_lock(1729364207);
  select coalesce(max(sequence), 0) into current_head from public.public_knowledge_events;
  if current_head <> p_knowledge_version then return false; end if;

  select * into job from public.public_spatial_snapshot_jobs
  where singleton is true for update;
  if not found
    or job.desired_knowledge_version <> p_knowledge_version
    or job.status <> 'running'
    or job.lease_session_id <> p_session_id
    or job.lease_token <> p_lease_token
    or job.lease_expires_at <= clock_timestamp()
    or (job.desired_graph_signature is not null and job.desired_graph_signature <> p_graph_signature) then
    return false;
  end if;
  if not exists (
    select 1 from public.public_spatial_snapshot_workers
    where session_id = p_session_id and actor_id = actor
      and last_seen_at > clock_timestamp() - interval '3 minutes'
  ) then
    return false;
  end if;

  insert into public.public_spatial_snapshots (
    singleton, knowledge_version, algorithm_version, graph_signature,
    snapshot_checksum, snapshot, updated_by
  ) values (
    true, p_knowledge_version, p_algorithm_version, p_graph_signature,
    p_snapshot_checksum, p_snapshot_data, actor
  )
  on conflict (singleton) do update
    set knowledge_version = excluded.knowledge_version,
        algorithm_version = excluded.algorithm_version,
        graph_signature = excluded.graph_signature,
        snapshot_checksum = excluded.snapshot_checksum,
        snapshot = excluded.snapshot,
        updated_at = clock_timestamp(),
        updated_by = excluded.updated_by
    where public.public_spatial_snapshots.knowledge_version < excluded.knowledge_version
      or public.public_spatial_snapshots.algorithm_version <> excluded.algorithm_version
      or public.public_spatial_snapshots.graph_signature <> excluded.graph_signature
      or public.public_spatial_snapshots.snapshot_checksum <> excluded.snapshot_checksum;

  update public.public_spatial_snapshot_jobs
    set desired_graph_signature = p_graph_signature,
        status = 'complete',
        lease_session_id = null,
        lease_token = null,
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where singleton is true and lease_token = p_lease_token;

  return true;
end;
$$;

-- Never allow clients to bypass job leases and publish directly.
revoke all on function public.publish_public_spatial_snapshot(bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_public_spatial_snapshot_rebuild() from public, anon, authenticated;

create or replace function public.broadcast_public_spatial_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  chunk_size constant integer := 128;
  total_nodes integer := jsonb_array_length(new.snapshot);
  chunk_count integer;
  chunk_index integer;
  chunk_data jsonb;
begin
  chunk_count := greatest(1, ceil(total_nodes::numeric / chunk_size)::integer);
  for chunk_index in 0..chunk_count - 1 loop
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
      into chunk_data
      from jsonb_array_elements(new.snapshot) with ordinality as nodes(value, ordinality)
      where ordinality > chunk_index * chunk_size
        and ordinality <= (chunk_index + 1) * chunk_size;

    perform realtime.send(
      jsonb_build_object(
        'knowledgeVersion', new.knowledge_version::text,
        'algorithmVersion', new.algorithm_version,
        'graphSignature', new.graph_signature,
        'checksum', new.snapshot_checksum,
        'chunkIndex', chunk_index,
        'chunkCount', chunk_count,
        'totalNodes', total_nodes,
        'nodes', chunk_data
      ),
      'spatial_snapshot_chunk',
      'public-spatial-snapshot',
      false
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.broadcast_public_spatial_snapshot() from public, anon, authenticated;

drop trigger if exists public_spatial_snapshot_broadcast on public.public_spatial_snapshots;
create trigger public_spatial_snapshot_broadcast
after insert or update on public.public_spatial_snapshots
for each row execute function public.broadcast_public_spatial_snapshot();

-- Bootstrap the singleton queue from the current event head. The first active
-- web client can publish the initial cache; no historical spatial snapshots exist.
do $$
declare
  latest public.public_knowledge_events%rowtype;
begin
  select * into latest from public.public_knowledge_events order by sequence desc limit 1;
  if found then
    insert into public.public_spatial_snapshot_jobs (
      singleton, desired_knowledge_version, requested_by, requested_at, status
    ) values (
      true, latest.sequence, latest.actor_id, clock_timestamp(), 'pending'
    )
    on conflict (singleton) do update
      set desired_knowledge_version = excluded.desired_knowledge_version,
          requested_by = excluded.requested_by,
          requested_at = excluded.requested_at,
          status = 'pending',
          lease_session_id = null,
          lease_token = null,
          lease_expires_at = null,
          updated_at = clock_timestamp()
      where public.public_spatial_snapshot_jobs.desired_knowledge_version < excluded.desired_knowledge_version;
  end if;
end;
$$;

revoke all on function public.register_public_spatial_snapshot_worker(uuid) from public, anon;
grant execute on function public.register_public_spatial_snapshot_worker(uuid) to authenticated;
revoke all on function public.heartbeat_public_spatial_snapshot_worker(uuid, uuid) from public, anon;
grant execute on function public.heartbeat_public_spatial_snapshot_worker(uuid, uuid) to authenticated;
revoke all on function public.request_public_spatial_snapshot_rebuild(uuid, bigint, text, boolean) from public, anon;
grant execute on function public.request_public_spatial_snapshot_rebuild(uuid, bigint, text, boolean) to authenticated;
revoke all on function public.claim_public_spatial_snapshot_job(uuid) from public, anon;
grant execute on function public.claim_public_spatial_snapshot_job(uuid) to authenticated;
revoke all on function public.release_public_spatial_snapshot_job(uuid, uuid) from public, anon;
grant execute on function public.release_public_spatial_snapshot_job(uuid, uuid) to authenticated;
revoke all on function public.publish_public_spatial_snapshot_with_lease(bigint, text, text, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.publish_public_spatial_snapshot_with_lease(bigint, text, text, text, jsonb, uuid, uuid) to authenticated;

create or replace function public.knowledge_ball_schema_version() returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select '20261103090000'::text $$;
revoke all on function public.knowledge_ball_schema_version() from public, anon;
grant execute on function public.knowledge_ball_schema_version() to authenticated;

comment on table public.public_spatial_snapshot_jobs is
  'Single mutable coordination row for the current spatial snapshot rebuild; it is not a history table.';
comment on table public.public_spatial_snapshot_workers is
  'Short-lived authenticated browser worker sessions used for submitter/online/new-page priority and lease heartbeats.';
