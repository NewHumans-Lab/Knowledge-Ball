import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KnowledgeBallAuthClient, GUEST_SESSION_KEY } from '../auth/AuthClient';
import { FetchDeadlineError, withFetchDeadline } from '../net/FetchDeadline';
import { ProjectionRenderScheduler } from '../ui/ProjectionRenderScheduler';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

// A synchronous authoritative replay burst must schedule exactly one expensive
// derived render/layout refresh, regardless of event count.
const scheduled: Array<() => void> = [];
let renderFlushes = 0;
const renderScheduler = new ProjectionRenderScheduler(
  () => { renderFlushes += 1; },
  callback => { scheduled.push(callback); },
);
for (let index = 0; index < 343; index += 1) renderScheduler.request();
assert.equal(scheduled.length, 1, '343 event notifications must coalesce to one scheduled render refresh');
assert.equal(renderFlushes, 0, 'expensive render work must not run inside each event append');
scheduled.shift()!();
assert.equal(renderFlushes, 1, 'one coalesced render refresh must run after the burst');
assert.equal(renderScheduler.flushCount(), 1);

// flushNow is safe for explicit synchronization and makes an already queued
// callback stale instead of double-running the layout.
renderScheduler.request();
assert.equal(scheduled.length, 1);
renderScheduler.flushNow();
assert.equal(renderFlushes, 2);
scheduled.shift()!();
assert.equal(renderFlushes, 2, 'stale queued callback must not cause a second layout');

// Multiple startup consumers share one auth owner; within that owner an expired
// session refresh is single-flight instead of issuing parallel refresh requests.
const storage = new MemoryStorage();
storage.setItem(GUEST_SESSION_KEY, JSON.stringify({
  access_token: 'expired',
  refresh_token: 'refresh-me',
  expires_at: 1,
}));
let refreshRequests = 0;
const auth = new KnowledgeBallAuthClient({
  url: 'https://example.supabase.co',
  publishableKey: 'publishable',
  storage,
  requestTimeoutMs: 1_000,
  fetch: (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes('/auth/v1/token?grant_type=refresh_token')) throw new Error(`Unexpected request: ${url}`);
    refreshRequests += 1;
    await Promise.resolve();
    return new Response(JSON.stringify({
      access_token: 'fresh-token',
      refresh_token: 'fresh-refresh',
      expires_in: 3600,
    }), { status: 200 });
  }) as typeof fetch,
});
const sessions = await Promise.all([
  auth.publicSession(),
  auth.publicSession(),
  auth.publicSession(),
]);
assert.equal(refreshRequests, 1, 'concurrent session consumers must share one refresh request');
assert.ok(sessions.every(session => session.access_token === 'fresh-token'));

// A transport that never resolves cannot hold the synchronization queue forever.
const never = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
})) as typeof fetch;
await assert.rejects(
  withFetchDeadline(never, 20)('https://example.invalid/hang'),
  error => error instanceof FetchDeadlineError && error.timeoutMs === 20,
  'network deadline must reject a hung request',
);

// Guard the actual application wiring: first frame starts before hosted hydration,
// and event subscribers no longer rebuild the complete 3D layout synchronously.
const appSource = readFileSync('src/ui/app.ts', 'utf8');
const sceneStartIndex = appSource.indexOf('scene.start();');
const bootstrapIndex = appSource.indexOf('void bootstrapRemoteFirst({');
assert.ok(sceneStartIndex >= 0 && bootstrapIndex >= 0 && sceneStartIndex < bootstrapIndex,
  'scene.start() must happen before remote-first hydration begins');
const subscriberStart = appSource.indexOf('store.subscribe((event) => {');
const subscriberEnd = appSource.indexOf('\n});\n\nsyncNodesFromProjection();', subscriberStart);
assert.ok(subscriberStart >= 0 && subscriberEnd > subscriberStart, 'store subscriber block must be discoverable');
const subscriberSource = appSource.slice(subscriberStart, subscriberEnd);
assert.match(subscriberSource, /projection\.apply\(event\)/, 'authoritative projection must still apply every event');
assert.match(subscriberSource, /projectionRenderScheduler\.request\(\)/, 'subscriber must request a coalesced derived render');
assert.doesNotMatch(subscriberSource, /syncNodesFromProjection\(\)/,
  'subscriber must never rebuild the full layout once per authoritative event');

console.log('Startup performance regression tests passed');
