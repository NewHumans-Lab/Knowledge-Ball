import assert from 'node:assert/strict';
import { createNode } from '../command/CreateNode';
import { editNode } from '../command/EditNode';
import { setMastery } from '../command/SetMastery';
import type { PublicKnowledgeEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import type { StorageLike } from '../persistence/KnowledgePersistence';
import { RemoteHeadConflictError, type PushResult, type SyncAdapter, type SyncBatch } from './SyncAdapter';
import { SyncEngine } from './SyncEngine';
import { SyncMetadataStore } from './SyncMetadata';
import { SupabaseSyncAdapter } from './SupabaseSyncAdapter';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}
class MemoryPersistence implements EventPersistence {
  constructor(private events: any[] = []) {}
  loadLocal() { return structuredClone(this.events); }
  saveLocal(events: any[]) { this.events = structuredClone(events); }
}
class RemoteStream implements SyncAdapter {
  events: PublicKnowledgeEvent[] = [];
  online = true;
  pushes: string[][] = [];
  async pull(cursor = '0'): Promise<SyncBatch> {
    if (!this.online) throw new Error('offline');
    return { events: this.events.slice(Number(cursor)), cursor: String(this.events.length) };
  }
  async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    if (!this.online) throw new Error('offline');
    if (Number(expectedCursor) !== this.events.length) throw new RemoteHeadConflictError(String(this.events.length));
    this.pushes.push(events.map(event => event.id));
    for (const event of events) if (!this.events.some(existing => existing.id === event.id)) this.events.push(structuredClone(event));
    return { cursor: String(this.events.length), acknowledgedEventIds: events.map(event => event.id) };
  }
}
function client(remote: SyncAdapter, storage = new MemoryStorage(), persistence = new MemoryPersistence(), validate: (event: PublicKnowledgeEvent) => string | null = () => null) {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(() => structuredClone(projection.state), persistence);
  store.subscribe(event => projection.apply(event));
  const engine = new SyncEngine(store, remote, new SyncMetadataStore(storage), validate);
  return { store, projection, engine, storage, persistence };
}

const remote = new RemoteStream();
const a = client(remote);
const b = client(remote);
await createNode(a.store, { nodeId: 'shared', title: 'A created', nodeType: 'fact', reasoning: 'r', premises: [] });
assert.equal(a.projection.state.nodesById.shared.title, 'A created', 'local projection updates before sync');
await a.engine.sync();
await b.engine.sync();
assert.equal(b.projection.state.nodesById.shared.title, 'A created', 'A -> remote -> B');
await editNode(b.store, { nodeId: 'shared', title: 'B edited' });
await b.engine.sync();
await a.engine.sync();
assert.equal(a.projection.state.nodesById.shared.title, 'B edited', 'B -> remote -> A');

remote.online = false;
await editNode(a.store, { nodeId: 'shared', reasoning: 'offline work' });
await assert.rejects(a.engine.sync());
assert.equal(a.engine.pendingCount(), 1, 'offline event remains pending');
remote.online = true;
await a.engine.sync();
assert.equal(a.engine.pendingCount(), 0, 'reconnect flushes pending work');
const pushesBeforeReload = remote.pushes.length;
const reloaded = client(remote, a.storage, a.persistence);
await reloaded.engine.sync();
assert.equal(remote.pushes.length, pushesBeforeReload, 'acknowledged events are not repushed after reload');

const preexistingRemote = new RemoteStream();
const preexistingProjection = new GraphProjection();
const preexistingPersistence = new MemoryPersistence();
const preexistingStore = new EventStore<GraphState>(() => structuredClone(preexistingProjection.state), preexistingPersistence);
preexistingStore.subscribe(event => preexistingProjection.apply(event));
await createNode(preexistingStore, { nodeId: 'before-engine', title: 'Created before engine', nodeType: 'fact', reasoning: '', premises: [] });
const preexistingEngine = new SyncEngine(preexistingStore, preexistingRemote, new SyncMetadataStore(new MemoryStorage()));
assert.equal(preexistingEngine.pendingCount(), 1, 'public events created before SyncEngine construction are reconciled into pending');
await preexistingEngine.sync();
assert.equal(preexistingRemote.events.length, 1, 'preexisting public event is uploaded on first hosted sync');
assert.equal(preexistingEngine.pendingCount(), 0, 'preexisting public event is acknowledged after upload');

const duplicate = remote.events[0];
await remote.push([duplicate], String(remote.events.length));
assert.equal(remote.events.filter(event => event.id === duplicate.id).length, 1, 'duplicate append is idempotent');

const concurrent = new RemoteStream();
const c = client(concurrent); const d = client(concurrent);
await createNode(c.store, { nodeId: 'c', title: 'C', nodeType: 'fact', reasoning: '', premises: [] });
await createNode(d.store, { nodeId: 'd', title: 'D', nodeType: 'fact', reasoning: '', premises: [] });
await c.engine.sync();
await d.engine.sync();
assert.deepEqual(concurrent.events.map(event => event.type === 'NodeCreated' ? event.payload.nodeId : ''), ['c', 'd'], 'conflict pulls, rebases, and retries');

class StaleOnceStream extends RemoteStream {
  stale = true;
  override async pull(cursor = '0'): Promise<SyncBatch> {
    if (this.stale) { this.stale = false; return { events: [], cursor }; }
    return super.pull(cursor);
  }
}
const invalidRemote = new StaleOnceStream();
const invalid = client(invalidRemote, new MemoryStorage(), new MemoryPersistence(), event =>
  event.type === 'NodeEdited' && event.payload.nodeId === 'missing' ? 'target deleted during rebase' : null);
await editNode(invalid.store, { nodeId: 'missing', title: 'cannot apply' });
invalidRemote.events.push({ id: 'winner', type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: 1,
  payload: { nodeId: 'winner', title: 'winner', nodeType: 'fact', reasoning: '', premises: [] } });
await invalid.engine.sync();
assert.equal(invalid.engine.failures()[0]?.reason, 'target deleted during rebase', 'invalidated local event is explicit');

const privacyRemote = new RemoteStream();
const owner = client(privacyRemote); const other = client(privacyRemote);
await createNode(owner.store, { nodeId: 'private-test', title: 'Public', nodeType: 'fact', reasoning: '', premises: [] });
await setMastery(owner.store, { nodeId: 'private-test', mastery: 'mastered' });
await owner.engine.sync();
assert.ok(privacyRemote.events.every(event => event.scope === 'public'));
assert.ok(!JSON.stringify(privacyRemote.events).includes('mastered'), 'public serialization contains no mastery payload');
await other.engine.sync();
await setMastery(other.store, { nodeId: 'private-test', mastery: 'touched' });
await editNode(owner.store, { nodeId: 'private-test', reasoning: 'public update' });
await owner.engine.sync();
await other.engine.sync();
assert.equal(other.projection.state.nodesById['private-test'].mastery, 'touched', 'public replay preserves personal mastery');

const supabaseStorage = new MemoryStorage();
supabaseStorage.setItem('knowledge-ball.supabase-session.v1', JSON.stringify({ access_token: 'test-token', expires_at: 9_999_999_999 }));
const pagedEvents = [0, 1, 2].map(index => ({
  sequence: index + 1,
  envelope: { id: `page-${index}`, type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: index,
    payload: { nodeId: `page-${index}`, title: 'page', nodeType: 'fact', reasoning: '', premises: [] } } as PublicKnowledgeEvent,
}));
const supabase = new SupabaseSyncAdapter({ url: 'https://example.supabase.co', publishableKey: 'publishable', pageSize: 2,
  storage: supabaseStorage, fetch: (async (input: string | URL | Request) => {
    const after = Number(new URL(String(input)).searchParams.get('sequence')?.replace('gt.', '') ?? 0);
    return new Response(JSON.stringify(pagedEvents.filter(row => row.sequence > after).slice(0, 2)), { status: 200 });
  }) as typeof fetch });
const paged = await supabase.pull('0');
assert.deepEqual(paged.events.map(event => event.id), ['page-0', 'page-1', 'page-2'], 'Supabase cursor paging has no gaps');
await assert.rejects(supabase.push([{ id: 'private', type: 'NodeMasterySet', scope: 'personal', schemaVersion: 1,
  timestamp: 1, payload: { nodeId: 'x', mastery: 'mastered' } } as any], '0'), /Personal events/);

console.log('Scheme 7 sync and privacy regression tests passed');
