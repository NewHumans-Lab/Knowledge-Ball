import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [adapter, app, helper, migration, packageJson] = await Promise.all([
  readFile('src/sync/SupabaseSyncAdapter.ts', 'utf8'),
  readFile('src/ui/app.ts', 'utf8'),
  readFile('src/ui/scene/SpatialLayoutSnapshot.ts', 'utf8'),
  readFile('supabase/migrations/202611020001_public_spatial_layout_snapshots.sql', 'utf8'),
  readFile('package.json', 'utf8'),
]);

assert.match(helper, /applyUniformLayerLayout/);
assert.match(helper, /node\.address/);
assert.match(helper, /node\.pos/);
assert.match(helper, /node\.homePos/);
assert.match(helper, /SPATIAL_LAYOUT_ALGORITHM_VERSION/);
assert.match(helper, /spatialLayoutGraphSignature/);
assert.match(helper, /snapshot\.knowledgeVersion !== expectedKnowledgeVersion/);
assert.match(app, /loadSpatialSnapshot\(\)/);
assert.match(app, /publishSpatialSnapshot\(snapshot\)/);
assert.match(app, /deferRemoteLayout/);
assert.match(adapter, /public_spatial_snapshots/);
assert.match(adapter, /publish_public_spatial_snapshot/);
assert.doesNotMatch(adapter, /service[_-]?role/i,
  'spatial cache must never use a privileged service-role key');
assert.match(migration, /enable row level security/i);
assert.match(migration, /grant select on public\.public_spatial_snapshots to authenticated/i);
assert.match(migration, /revoke all on public\.public_spatial_snapshots from public, anon, authenticated/i);
assert.match(migration, /pg_advisory_xact_lock\(1729364207\)/);
assert.match(migration, /current_head <> expected_knowledge_version/);
assert.match(migration, /duplicate shell occupancy/);
assert.match(migration, /deterministic-5r-isg-v1/);
assert.match(migration, /select '202611020001'::text/);
assert.match(packageJson, /SpatialLayoutSnapshot\.test\.ts/);
assert.match(packageJson, /SpatialSnapshotSyncRegression\.test\.ts/);

console.log('Spatial snapshot wiring, cache-only semantics, RLS and version-guard architecture checks passed');
