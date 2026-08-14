import assert from 'node:assert/strict';
import { editNode } from '../command/EditNode';
import { resolveNode } from '../command/ResolveNode';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
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
import { isDemoSeedEvent } from '../demo/seedDemoKnowledge';
import { isCanonicalPublicKnowledgeEvent } from '../event/Event';
import { bootstrapRemoteFirst } from '../bootstrap/RemoteFirstBootstrap';

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
async function addAtomic(target:ReturnType<typeof client>,nodeId:string,title:string,reasoning='r'){
  await executeKnowledgeEdit(target.store,target.projection,{kind:'add',mode:'atomic',node:{id:nodeId,title,type:'fact',reasoning}});
}

const populatedRemote=new RemoteStream();const populatedWriter=client(populatedRemote);await addAtomic(populatedWriter,'remote-existing','Remote existing knowledge');await populatedWriter.engine.sync();
const freshHostedBrowser=client(populatedRemote,new MemoryStorage(),new MemoryPersistence());let unexpectedDemoSeeds=0;
await bootstrapRemoteFirst({hosted:true,hydrateRemote:()=>freshHostedBrowser.engine.sync(),hasKnowledge:()=>Object.keys(freshHostedBrowser.projection.state.nodesById).length>0,seedDemo:async()=>{unexpectedDemoSeeds++;}});
assert.equal(freshHostedBrowser.projection.state.nodesById['remote-existing'].title,'Remote existing knowledge','fresh browser hydrates remote knowledge first');
assert.equal(unexpectedDemoSeeds,0,'remote knowledge plus empty localStorage must never seed demo');
assert.equal(populatedRemote.pushes.length,1,'fresh browser hydration must not append any public event');

const remote = new RemoteStream();
const a = client(remote);
const b = client(remote);
await addAtomic(a,'shared','A created');
assert.equal(a.projection.state.nodesById.shared.title, 'A created', 'local projection updates before sync');
await a.engine.sync();
await b.engine.sync();
assert.equal(b.projection.state.nodesById.shared.title, 'A created', 'A -> remote -> B');
await editNode(b.store, { nodeId: 'shared', title: 'B edited' });
await b.engine.sync();
await a.engine.sync();
assert.equal(a.projection.state.nodesById.shared.title, 'B edited', 'B -> remote -> A');
await resolveNode(a.store,{nodeId:'shared'});await a.engine.sync();await b.engine.sync();
assert.equal(b.projection.state.nodesById.shared.status,'verified','canonical status event syncs across clients');
assert.ok(remote.events.every(event=>!event.type.startsWith('Node')),'new public writes never use legacy Node* event families');

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
await executeKnowledgeEdit(preexistingStore,preexistingProjection,{kind:'add',mode:'atomic',node:{id:'before-engine',title:'Created before engine',type:'fact',reasoning:'before engine'}});
const preexistingEngine = new SyncEngine(preexistingStore, preexistingRemote, new SyncMetadataStore(new MemoryStorage()));
assert.equal(preexistingEngine.pendingCount(), 1, 'public events created before SyncEngine construction are reconciled into pending');
await preexistingEngine.sync();
assert.equal(preexistingRemote.events.length, 1, 'preexisting public event is uploaded on first hosted sync');
assert.equal(preexistingEngine.pendingCount(), 0, 'preexisting public event is acknowledged after upload');

const legacyStorage=new MemoryStorage();legacyStorage.setItem('knowledge-ball.sync-metadata.v1',JSON.stringify({schemaVersion:1,cursor:'0',pendingEventIds:['legacy-edit'],acknowledgedEventIds:[],failedEvents:[]}));
const legacyEvent={id:'legacy-edit',type:'NodeEdited',scope:'public',schemaVersion:1,timestamp:1,payload:{nodeId:'old',title:'offline legacy'}} as const;
const legacyClient=client(new RemoteStream(),legacyStorage,new MemoryPersistence([legacyEvent]));
assert.equal(legacyClient.engine.pendingCount(),0,'legacy pending IDs must not remain stuck forever');
assert.match(legacyClient.engine.failures()[0]?.reason??'',/重新提交/,'legacy offline writes are explicitly surfaced instead of silently dropped');

const demoEvent={id:'demo-n1',type:'KnowledgeAdded',scope:'public',schemaVersion:1,timestamp:1,payload:{edit:{kind:'add',mode:'atomic',node:{id:'n1',title:'同一律',type:'axiom',reasoning:'demo'}}}} as PublicKnowledgeEvent;
const demoStorage=new MemoryStorage();demoStorage.setItem('knowledge-ball.sync-metadata.v1',JSON.stringify({schemaVersion:1,cursor:'0',pendingEventIds:['demo-n1'],acknowledgedEventIds:[],failedEvents:[]}));
const demoProjection=new GraphProjection(),demoStore=new EventStore<GraphState>(()=>structuredClone(demoProjection.state),new MemoryPersistence([demoEvent]));demoStore.subscribe(event=>demoProjection.apply(event));
const demoRemote=new RemoteStream(),hostedDemoEngine=new SyncEngine(demoStore,demoRemote,new SyncMetadataStore(demoStorage),()=>null,event=>isCanonicalPublicKnowledgeEvent(event)&&!isDemoSeedEvent(event));
assert.equal(hostedDemoEngine.pendingCount(),0,'hosted production suppresses restored demo seed events');await hostedDemoEngine.sync();
assert.equal(demoRemote.pushes.length,0,'empty localStorage against hosted knowledge never uploads demo events');

const duplicate = remote.events[0];
await remote.push([duplicate], String(remote.events.length));
assert.equal(remote.events.filter(event => event.id === duplicate.id).length, 1, 'duplicate append is idempotent');

const concurrent = new RemoteStream();
const c = client(concurrent); const d = client(concurrent);
await addAtomic(c,'c','C','c');
await addAtomic(d,'d','D','d');
await c.engine.sync();
await d.engine.sync();
assert.deepEqual(concurrent.events.map(event => event.type === 'KnowledgeAdded' && event.payload.edit.mode === 'atomic' ? event.payload.edit.node.id : ''), ['c', 'd'], 'conflict pulls, rebases, and retries');

class StaleOnceStream extends RemoteStream {
  stale = true;
  override async pull(cursor = '0'): Promise<SyncBatch> {
    if (this.stale) { this.stale = false; return { events: [], cursor }; }
    return super.pull(cursor);
  }
}
const invalidRemote = new StaleOnceStream();
const invalid = client(invalidRemote, new MemoryStorage(), new MemoryPersistence(), event =>
  event.type === 'KnowledgeNodeEdited' && event.payload.edit.nodeId === 'missing' ? 'target deleted during rebase' : null);
await editNode(invalid.store, { nodeId: 'missing', title: 'cannot apply' });
invalidRemote.events.push({ id: 'winner', type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: 1,
  payload: { nodeId: 'winner', title: 'winner', nodeType: 'fact', reasoning: '', premises: [] } });
await invalid.engine.sync();
assert.equal(invalid.engine.failures()[0]?.reason, 'target deleted during rebase', 'invalidated local event is explicit');

const privacyRemote = new RemoteStream();
const owner = client(privacyRemote); const other = client(privacyRemote);
await addAtomic(owner,'private-test','Public','public');
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
  timestamp: 1, payload: { nodeId: 'x', mastery: 'mastered' } } as any], '0'), /canonical public knowledge events/);

const blockedStorage: StorageLike = {
  getItem() { throw new Error('storage blocked'); },
  setItem() { throw new Error('storage blocked'); },
  removeItem() { throw new Error('storage blocked'); },
};
let anonymousSignupRequests = 0;
const storageResilientSupabase = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'publishable',
  storage: blockedStorage,
  fetch: (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/signup')) {
      anonymousSignupRequests += 1;
      return new Response(JSON.stringify({ access_token: 'ephemeral-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/rest/v1/public_knowledge_events')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch,
});
await storageResilientSupabase.pull('0');
assert.equal(anonymousSignupRequests, 1, 'blocked localStorage must not prevent anonymous Supabase authentication');

const originalGlobalFetch = globalThis.fetch;
let defaultFetchReceiverCorrect = false;
try {
  globalThis.fetch = (async function(this: typeof globalThis, input: string | URL | Request) {
    defaultFetchReceiverCorrect = this === globalThis;
    const url = String(input);
    if (url.endsWith('/auth/v1/signup')) {
      return new Response(JSON.stringify({ access_token: 'bound-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/rest/v1/public_knowledge_events')) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const defaultFetchSupabase = new SupabaseSyncAdapter({
    url: 'https://example.supabase.co',
    publishableKey: 'publishable',
    storage: new MemoryStorage(),
  });
  await defaultFetchSupabase.pull('0');
  assert.equal(defaultFetchReceiverCorrect, true, 'default browser/global fetch must keep its required receiver');
} finally {
  globalThis.fetch = originalGlobalFetch;
}

console.log('Scheme 7 sync and privacy regression tests passed');
