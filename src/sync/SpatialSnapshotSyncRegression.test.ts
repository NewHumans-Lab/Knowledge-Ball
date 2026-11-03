import assert from 'node:assert/strict';
import { SupabaseSyncAdapter } from './SupabaseSyncAdapter';
import { spatialSnapshotChecksum, type SpatialLayoutSnapshot } from './SpatialSnapshot';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const storage = new MemoryStorage();
storage.setItem('knowledge-ball.supabase-session.v1', JSON.stringify({
  access_token: 'test-session-token', expires_at: 9_999_999_999,
}));
const nodes: SpatialLayoutSnapshot['nodes'] = [
  { id: 'node-a', address: { shellID: 'shell:180.000000', cellID: 2 }, pos: { x: 1, y: 2, z: 3 } },
  { id: 'reasoning-a', address: null, pos: { x: 4, y: 5, z: 6 } },
];
const snapshot: SpatialLayoutSnapshot = {
  schemaVersion: 1,
  knowledgeVersion: '44',
  algorithmVersion: 'deterministic-5r-isg-v1',
  graphSignature: 'deadbeef',
  checksum: spatialSnapshotChecksum(nodes),
  nodes,
};
let publishResult = true;
const publishedBodies: Record<string, unknown>[] = [];
const requests: string[] = [];
const adapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
  storage,
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    assert.match(new Headers(init?.headers).get('Authorization') ?? '', /^Bearer test-session-token$/);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.includes('/rest/v1/public_spatial_snapshots?')) {
      return new Response(JSON.stringify([{
        knowledge_version: 44,
        algorithm_version: snapshot.algorithmVersion,
        graph_signature: snapshot.graphSignature,
        snapshot_checksum: snapshot.checksum,
        snapshot: snapshot.nodes,
      }]), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/register_public_spatial_snapshot_worker')
      || url.endsWith('/rest/v1/rpc/heartbeat_public_spatial_snapshot_worker')
      || url.endsWith('/rest/v1/rpc/request_public_spatial_snapshot_rebuild')
      || url.endsWith('/rest/v1/rpc/release_public_spatial_snapshot_job')) {
      publishedBodies.push(body);
      return new Response('true', { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/claim_public_spatial_snapshot_job')) {
      return new Response(JSON.stringify([{
        knowledge_version: 44,
        graph_signature: snapshot.graphSignature,
        lease_token: 'lease-token',
        lease_expires_at: '2026-11-03T12:00:00Z',
        priority: 1,
      }]), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/publish_public_spatial_snapshot_with_lease')) {
      publishedBodies.push(body);
      return new Response(JSON.stringify(publishResult), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + url);
  }) as typeof fetch,
});

const loaded = await adapter.loadSpatialSnapshot();
assert.deepEqual(loaded, snapshot, 'saved geometry and checksum must be read without modification');
assert.equal(await adapter.registerSpatialWorker('00000000-0000-4000-8000-000000000001'), true);
assert.equal(await adapter.heartbeatSpatialWorker('00000000-0000-4000-8000-000000000001', 'lease-token'), true);
assert.equal(await adapter.requestSpatialSnapshotRebuild(
  '00000000-0000-4000-8000-000000000001', '44', snapshot.graphSignature, true,
), true);
const claim = await adapter.claimSpatialSnapshotJob('00000000-0000-4000-8000-000000000001');
assert.equal(claim?.priority, 1, 'database claim response exposes submitter-first priority');
assert.equal(await adapter.publishSpatialSnapshotWithLease(
  snapshot, '00000000-0000-4000-8000-000000000001', 'lease-token',
), true);
const publishBody = publishedBodies.find(body => body.p_snapshot_checksum !== undefined)!;
assert.equal(publishBody.p_knowledge_version, 44);
assert.equal(publishBody.p_algorithm_version, snapshot.algorithmVersion);
assert.equal(publishBody.p_graph_signature, snapshot.graphSignature);
assert.equal(publishBody.p_snapshot_checksum, snapshot.checksum);
assert.deepEqual(publishBody.p_snapshot_data, snapshot.nodes);
assert.equal(publishBody.p_session_id, '00000000-0000-4000-8000-000000000001');
assert.equal(publishBody.p_lease_token, 'lease-token');
assert.ok(requests.every(url => !url.includes('service_role')), 'browser writes must use authenticated publishable-key requests');
publishResult = false;
assert.equal(await adapter.publishSpatialSnapshotWithLease(
  snapshot, '00000000-0000-4000-8000-000000000001', 'stale-lease',
), false, 'a stale event-head or lease compare-and-swap must not publish');

const emptyAdapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
  storage,
  fetch: (async () => new Response('[]', { status: 200 })) as typeof fetch,
});
assert.equal(await emptyAdapter.loadSpatialSnapshot(), null, 'new projects have no snapshot row');
console.log('Supabase singleton snapshot, worker lease and compare-and-swap adapter tests passed');
