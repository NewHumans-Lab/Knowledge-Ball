import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  adapter, app, helper, worker, workerClient, realtime, coordinator,
  baseMigration, migration, packageJson,
] = await Promise.all([
  readFile('src/sync/SupabaseSyncAdapter.ts', 'utf8'),
  readFile('src/ui/app.ts', 'utf8'),
  readFile('src/ui/scene/SpatialLayoutSnapshot.ts', 'utf8'),
  readFile('src/ui/scene/SpatialSnapshotLayoutWorker.ts', 'utf8'),
  readFile('src/sync/SpatialSnapshotLayoutWorker.ts', 'utf8'),
  readFile('src/sync/SupabaseRealtimeBroadcast.ts', 'utf8'),
  readFile('src/sync/SpatialSnapshotWorkerCoordinator.ts', 'utf8'),
  readFile('supabase/migrations/202611020001_public_spatial_layout_snapshots.sql', 'utf8'),
  readFile('supabase/migrations/20261103090000_spatial_snapshot_coordination.sql', 'utf8'),
  readFile('package.json', 'utf8'),
]);

assert.match(helper, /applyUniformLayerLayout/);
assert.match(helper, /node\.address/);
assert.match(helper, /node\.pos/);
assert.match(helper, /node\.homePos/);
assert.match(helper, /SPATIAL_LAYOUT_ALGORITHM_VERSION/);
assert.match(helper, /spatialLayoutGraphSignature/);
assert.match(helper, /snapshot\.knowledgeVersion !== expectedKnowledgeVersion/);
assert.match(helper, /restoreSpatialLayoutSnapshotPositions/);
assert.match(helper, /spatialSnapshotChecksum/);

assert.match(app, /loadSpatialSnapshot\(\)/);
assert.match(app, /SpatialSnapshotWorkerCoordinator/);
assert.match(app, /restoreSpatialLayoutSnapshotPositions/);
assert.match(app, /requestLatestRebuild\(true\)/);
assert.doesNotMatch(app, /applyUniformLayerLayout\(/,
  'render and bootstrap paths must not run the 5R solver');
assert.doesNotMatch(app, /publishSpatialSnapshot\(/,
  'clients must publish only through a claimed worker lease');

assert.match(worker, /applyUniformLayerLayout/);
assert.match(workerClient, /new Worker\(/);
assert.match(workerClient, /SpatialSnapshotLayoutWorker\.ts/);
assert.match(adapter, /public_spatial_snapshots/);
assert.match(adapter, /publish_public_spatial_snapshot_with_lease/);
assert.match(adapter, /claim_public_spatial_snapshot_job/);
assert.match(adapter, /snapshot_checksum/);
assert.match(adapter, /realtimeAccessToken/);
assert.doesNotMatch(adapter, /service[_-]?role/i,
  'browser cache access must never use a privileged service-role key');

assert.match(realtime, /realtime\/v1\/websocket/);
assert.match(realtime, /spatial_snapshot_chunk/);
assert.match(realtime, /spatial_snapshot_rebuild_requested/);
assert.match(realtime, /private: true/,
  'browser clients must subscribe privately so they cannot spoof database-originated snapshot chunks');
assert.match(coordinator, /spatialSnapshotChecksum/);
assert.match(coordinator, /chunkCount/);
assert.match(coordinator, /publishSpatialSnapshotWithLease/);
assert.match(coordinator, /requestLatestRebuild/);

assert.match(baseMigration, /enable row level security/i);
assert.match(baseMigration, /pg_advisory_xact_lock\(1729364207\)/);
assert.match(migration, /public_spatial_snapshot_workers/);
assert.match(migration, /public_spatial_snapshot_jobs/);
assert.match(migration, /enable row level security/);
assert.match(migration, /realtime\.send/);
assert.match(migration, /chunk_size constant integer := 128/);
assert.match(migration, /requested_at \+ interval '20 seconds'/);
assert.match(migration, /lease_expires_at <= clock_timestamp\(\)/);
assert.match(migration, /current_head <> p_knowledge_version/);
assert.match(migration, /publish_public_spatial_snapshot_with_lease/);
assert.match(migration, /revoke all on function public\.publish_public_spatial_snapshot\(bigint, text, text, jsonb\) from public, anon, authenticated/);
assert.match(migration, /snapshot_checksum/);
assert.match(migration, /create trigger public_spatial_snapshot_broadcast/);
assert.match(migration, /singleton boolean primary key/);
assert.match(migration, /20261103090000/);
assert.match(packageJson, /SpatialLayoutSnapshot\.test\.ts/);
assert.match(packageJson, /SpatialSnapshotSyncRegression\.test\.ts/);
assert.match(packageJson, /SpatialSnapshotProtocol\.test\.ts/);

console.log('Global singleton snapshot, worker leases, priority, Web Worker layout, chunked Realtime and strict cache restore checks passed');
