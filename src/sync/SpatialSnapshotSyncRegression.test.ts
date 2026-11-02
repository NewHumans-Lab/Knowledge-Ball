import assert from 'node:assert/strict';
import { SupabaseSyncAdapter } from './SupabaseSyncAdapter';
import type { SpatialLayoutSnapshot } from './SpatialSnapshot';

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
const snapshot: SpatialLayoutSnapshot = {
  schemaVersion: 1,
  knowledgeVersion: '44',
  algorithmVersion: 'deterministic-5r-isg-v1',
  graphSignature: 'deadbeef',
  nodes: [
    { id: 'node-a', address: { shellID: 'shell:180.000000', cellID: 2 }, pos: { x: 1, y: 2, z: 3 } },
    { id: 'reasoning-a', address: null, pos: { x: 4, y: 5, z: 6 } },
  ],
};
let publishResult = true;
let publishedBody: Record<string, unknown> | null = null;
const requests: string[] = [];
const adapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
  storage,
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    assert.match(new Headers(init?.headers).get('Authorization') ?? '', /^Bearer test-session-token$/);
    if (url.includes('/rest/v1/public_spatial_snapshots?')) {
      return new Response(JSON.stringify([{
        knowledge_version: 44,
        algorithm_version: snapshot.algorithmVersion,
        graph_signature: snapshot.graphSignature,
        snapshot: snapshot.nodes,
      }]), { status: 200 });
    }
    if (url.endsWith('/rest/v1/rpc/publish_public_spatial_snapshot')) {
      publishedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify(publishResult), { status: 200 });
    }
    throw new Error('Unexpected Supabase request: ' + url);
  }) as typeof fetch,
});
const loaded = await adapter.loadSpatialSnapshot();
assert.deepEqual(loaded, snapshot, 'saved geometry must be read without modification');
assert.equal(await adapter.publishSpatialSnapshot(snapshot), true);
assert.equal(publishedBody?.expected_knowledge_version, 44);
assert.equal(publishedBody?.algorithm_version, snapshot.algorithmVersion);
assert.equal(publishedBody?.graph_signature, snapshot.graphSignature);
assert.deepEqual(publishedBody?.snapshot_data, snapshot.nodes);
assert.ok(requests.every(url => !url.includes('service_role')), 'browser writes must use authenticated publishable-key requests');
publishResult = false;
assert.equal(await adapter.publishSpatialSnapshot(snapshot), false, 'stale event-head compare-and-swap must not publish');

const emptyAdapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'sb_publishable_test',
  storage,
  fetch: (async () => new Response('[]', { status: 200 })) as typeof fetch,
});
assert.equal(await emptyAdapter.loadSpatialSnapshot(), null, 'new projects have no snapshot row');
console.log('Supabase spatial snapshot authenticated read and compare-and-swap write tests passed');
