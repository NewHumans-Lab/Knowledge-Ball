import assert from 'node:assert/strict';
import type { DomainEvent, PublicKnowledgeEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { GraphProjection } from '../projection/GraphProjection';
import { FilteredKnowledgePersistence, type StorageLike } from '../persistence/KnowledgePersistence';
import type { GraphState } from '../state/GraphState';
import type { PushResult, SyncAdapter, SyncBatch } from './SyncAdapter';
import { SyncEngine } from './SyncEngine';
import { PublicKnowledgeSyncCoordinator } from './PublicKnowledgeSyncCoordinator';

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

class NoPersistence implements EventPersistence {
  loadLocal(): DomainEvent[] { return []; }
  saveLocal(): void {}
}

class RemoteStream implements SyncAdapter {
  readonly events: PublicKnowledgeEvent[] = [];
  online = true;
  pullCount = 0;

  async pull(cursor = '0'): Promise<SyncBatch> {
    this.pullCount += 1;
    if (!this.online) throw new Error('offline');
    return { events: structuredClone(this.events.slice(Number(cursor))), cursor: String(this.events.length) };
  }

  async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    if (!this.online) throw new Error('offline');
    assert.equal(Number(expectedCursor), this.events.length, 'test remote expects the current authoritative head');
    for (const event of events) {
      if (!this.events.some(existing => existing.id === event.id)) this.events.push(structuredClone(event));
    }
    return { cursor: String(this.events.length), acknowledgedEventIds: events.map(event => event.id) };
  }
}

function publicAdd(eventId: string, nodeId: string, title: string): PublicKnowledgeEvent {
  return {
    id: eventId,
    type: 'KnowledgeAdded',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      edit: { kind: 'add', mode: 'atomic', node: { id: nodeId, title, type: 'fact', reasoning: title } },
      declaredLayers: { [nodeId]: 'inner' },
    },
  };
}

function personalMastery(eventId: string, nodeId: string): DomainEvent {
  return {
    id: eventId,
    type: 'NodeMasterySet',
    scope: 'personal',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: { nodeId, mastery: 'touched' },
  };
}

function client(remote: SyncAdapter | null, persistence: EventPersistence = new NoPersistence()) {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(() => structuredClone(projection.state), persistence);
  store.subscribe(event => projection.apply(event));
  return { projection, store, engine: new SyncEngine(store, remote) };
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for automatic public convergence');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// Historical mixed localStorage may remain physically present for compatibility,
// but its public events are dead data: only personal mastery can be restored.
const storage = new MemoryStorage();
const stalePublic = publicAdd('stale-public-event', 'stale-local-node', 'STALE LOCAL PUBLIC NODE');
const legacyPersonal = personalMastery('legacy-personal-event', 'cloud-node');
storage.setItem('knowledge-ball.events.v1', JSON.stringify({
  schemaVersion: 1,
  savedAt: new Date().toISOString(),
  events: [stalePublic, legacyPersonal],
}));
const filtered = new FilteredKnowledgePersistence<DomainEvent>({
  storageKey: 'knowledge-ball.personal-events.v1',
  legacyStorageKey: 'knowledge-ball.events.v1',
  storage,
  retain: event => event.type === 'NodeMasterySet',
});
const restored = client(null, filtered);
assert.deepEqual(restored.store.allEvents().map(event => event.type), ['NodeMasterySet'], 'legacy local public events must never enter the runtime EventStore');
assert.equal(restored.projection.state.nodesById['stale-local-node'], undefined, 'stale local public node must never enter GraphProjection');
assert.ok(storage.getItem('knowledge-ball.events.v1')?.includes('STALE LOCAL PUBLIC NODE'), 'legacy mixed cache may remain physically present while being ignored');
assert.ok(storage.getItem('knowledge-ball.personal-events.v1')?.includes('chunked-journal'), 'personal mastery migration must establish the dedicated bounded journal');
assert.ok(storage.getItem('knowledge-ball.personal-events.v1.chunk.v2.0')?.includes('NodeMasterySet'), 'personal mastery audit event must be retained in the journal chunk');

// A missing cloud is a hard public-write failure. There is no local public fallback.
const noCloud = client(null);
await assert.rejects(noCloud.engine.commit(publicAdd('no-cloud-event', 'no-cloud-node', 'NO CLOUD')), /只认云端确认/);
assert.equal(noCloud.store.size(), 0, 'rejected cloudless public write must not enter memory truth');
assert.equal(noCloud.projection.state.nodesById['no-cloud-node'], undefined, 'rejected cloudless public write must not render');

// Two already-open clients must converge automatically through the coordinator.
// Client B is deliberately never refreshed and engine.sync() is never called by the test.
const remote = new RemoteStream();
const a = client(remote);
const b = client(remote);
await a.engine.sync();
await b.engine.sync();
const pullCountBeforeCoordinator = remote.pullCount;
const coordinator = new PublicKnowledgeSyncCoordinator(
  () => b.engine.sync(),
  { intervalMs: 10, windowRef: null, documentRef: null, onError: error => { throw error; } },
);
coordinator.start();
try {
  await a.engine.commit(publicAdd('shared-event', 'shared-node', 'Shared cloud truth'));
  assert.equal(a.projection.state.nodesById['shared-node']?.title, 'Shared cloud truth', 'writer sees only the server-acknowledged public event');
  await waitFor(() => b.projection.state.nodesById['shared-node']?.title === 'Shared cloud truth');
  assert.equal(b.engine.currentCursor(), a.engine.currentCursor(), 'already-open clients converge to the same authoritative head');
  assert.ok(remote.pullCount > pullCountBeforeCoordinator, 'automatic convergence must perform a remote pull without a manual B sync call');

  remote.online = false;
  await assert.rejects(a.engine.commit(publicAdd('offline-event', 'offline-node', 'Offline local lie')), /offline/);
  assert.equal(a.projection.state.nodesById['offline-node'], undefined, 'offline public write must never become local memory truth');
  assert.equal(remote.events.some(event => event.id === 'offline-event'), false, 'offline public write must not appear in cloud truth');
} finally {
  coordinator.stop();
  a.engine.dispose();
  b.engine.dispose();
  restored.engine.dispose();
  noCloud.engine.dispose();
}

console.log('Cloud-only public-state and automatic convergence regression tests passed');