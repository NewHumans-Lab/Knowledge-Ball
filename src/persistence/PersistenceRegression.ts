import { EventStore, type EventPersistence } from '../event/EventStore';
import { GraphProjection } from '../projection/GraphProjection';
import { createNode } from '../command/CreateNode';
import { editNode } from '../command/EditNode';
import { resolveNode } from '../command/ResolveNode';
import { setMastery } from '../command/SetMastery';
import type { DomainEvent } from '../event/Event';
import type { GraphState } from '../state/GraphState';
import {
  FilteredKnowledgePersistence,
  KnowledgePersistence,
  type StorageLike,
} from './KnowledgePersistence';

class MemoryPersistence implements EventPersistence {
  events: DomainEvent[] = [];
  loadLocal(): DomainEvent[] { return structuredClone(this.events); }
  saveLocal(events: DomainEvent[]): void { this.events = structuredClone(events); }
}

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

function boot(persistence: EventPersistence): { store: EventStore<GraphState>; projection: GraphProjection } {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(() => structuredClone(projection.state), persistence);
  store.subscribe(event => projection.apply(event));
  return { store, projection };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function publicNodeEvent(id: string, nodeId: string): DomainEvent {
  return {
    id,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: { nodeId, title: nodeId, nodeType: 'fact', reasoning: '', premises: [], source: 'import' },
  };
}

function masteryEvent(id: string, nodeId: string, mastery: 'none' | 'touched' | 'mastered' = 'touched'): DomainEvent {
  return {
    id,
    type: 'NodeMasterySet',
    scope: 'personal',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: { nodeId, mastery },
  };
}

export async function runPersistenceRegression(): Promise<void> {
  // Generic persistence remains supported for tests/unconfigured tooling.
  const persistence = new MemoryPersistence();
  let runtime = boot(persistence);

  await createNode(runtime.store, { nodeId: 'a', title: 'A', nodeType: 'fact', reasoning: 'r1', premises: [] });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.a?.title === 'A', 'create→reload failed');

  await editNode(runtime.store, { nodeId: 'a', title: 'A2', reasoning: 'r2' });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.a?.title === 'A2', 'edit→reload failed');
  assert(runtime.projection.state.nodesById.a?.reasoning === 'r2', 'edit reasoning→reload failed');

  await resolveNode(runtime.store, { nodeId: 'a' });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.a?.status === 'verified', 'status→reload failed');

  await setMastery(runtime.store, { nodeId: 'a', mastery: 'mastered' });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.a?.mastery === 'mastered', 'mastery→reload failed');

  await createNode(runtime.store, { nodeId: 'b', title: 'B', nodeType: 'theorem', reasoning: 'r', premises: ['a'] });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.b?.premises[0] === 'a', 'relationship→reload failed');

  await editNode(runtime.store, { nodeId: 'b', premises: [] });
  runtime = boot(persistence);
  assert(runtime.projection.state.nodesById.b?.premises.length === 0, 'relationship edit→reload failed');

  const size = runtime.store.size();
  runtime = boot(persistence);
  runtime = boot(persistence);
  assert(runtime.store.size() === size, 'repeated reload duplicated events');
  assert(Object.keys(runtime.projection.state.nodesById).length === 2, 'repeated reload duplicated nodes');

  // Production migration rule: the historical mixed local cache is a read-only
  // compatibility source. Only personal mastery may be copied into the new key;
  // public knowledge must never become durable browser truth again.
  const storage = new MemoryStorage();
  const legacyKey = 'knowledge-ball.events.v1';
  const personalKey = 'knowledge-ball.personal-events.v1';
  const publicEvent = publicNodeEvent('legacy-public', 'legacy-node');
  const legacyMastery = masteryEvent('legacy-mastery', 'legacy-node', 'mastered');
  const legacyPersistence = new KnowledgePersistence<DomainEvent>({ storageKey: legacyKey, storage });
  legacyPersistence.saveLocal([publicEvent, legacyMastery]);
  const legacyRawBefore = storage.getItem(legacyKey);

  const personalPersistence = new FilteredKnowledgePersistence<DomainEvent>({
    storageKey: personalKey,
    legacyStorageKey: legacyKey,
    storage,
    retain: event => event.type === 'NodeMasterySet',
  });
  const migrated = personalPersistence.loadLocal();
  assert(migrated.length === 1 && migrated[0]?.id === 'legacy-mastery', 'legacy public events must be ignored while mastery is retained');
  assert(storage.getItem(legacyKey) === legacyRawBefore, 'legacy mixed cache must not be cleared or rewritten');
  assert(personalPersistence.shouldPersist(publicEvent) === false, 'public event must never be selected for browser persistence');
  assert(personalPersistence.shouldPersist(legacyMastery) === true, 'personal mastery remains locally persistable in this phase');
  const migratedMarker = JSON.parse(storage.getItem(personalKey) ?? '{}') as { schemaVersion?: number; format?: string; chunkCount?: number };
  assert(migratedMarker.schemaVersion === 2 && migratedMarker.format === 'chunked-journal', 'legacy mastery must migrate to the bounded journal format');
  assert(migratedMarker.chunkCount === 1, 'single migrated mastery event must occupy one journal chunk');

  personalPersistence.saveLocal([publicEvent, legacyMastery]);
  const reloadedPersonal = new FilteredKnowledgePersistence<DomainEvent>({
    storageKey: personalKey,
    legacyStorageKey: legacyKey,
    storage,
    retain: event => event.type === 'NodeMasterySet',
  }).loadLocal();
  assert(reloadedPersonal.length === 1 && reloadedPersonal[0]?.type === 'NodeMasterySet', 'new journal must reload personal events only without duplicating bulk compatibility saves');

  // EventStore must use the incremental append contract when available. A single
  // personal event after a long public history must never hand the whole store
  // history back to persistence.
  class AppendProbePersistence implements EventPersistence {
    appendCalls: DomainEvent[] = [];
    saveCalls = 0;
    loadLocal(): DomainEvent[] { return []; }
    saveLocal(): void { this.saveCalls += 1; }
    appendLocal(event: DomainEvent): void { this.appendCalls.push(event); }
    shouldPersist(event: DomainEvent): boolean { return event.type === 'NodeMasterySet'; }
  }
  const probe = new AppendProbePersistence();
  const probeStore = new EventStore<GraphState>(() => ({ nodesById: {} }), probe);
  for (let index = 0; index < 1500; index += 1) {
    probeStore.append(publicNodeEvent(`public-${index}`, `node-${index}`));
  }
  probeStore.append(masteryEvent('personal-after-long-history', 'node-1499'));
  assert(probe.saveCalls === 0, 'incremental persistence must not receive a full-history save after a personal event');
  assert(probe.appendCalls.length === 1 && probe.appendCalls[0]?.id === 'personal-after-long-history', 'incremental persistence must receive exactly the new persistable event');

  // The production filtered persistence retains every personal audit event while
  // bounding each localStorage payload to one small chunk. More history creates
  // more chunks rather than ever-growing rewrite work.
  const journalStorage = new MemoryStorage();
  const journalKey = 'personal-journal-regression';
  const journalPersistence = new FilteredKnowledgePersistence<DomainEvent>({
    storageKey: journalKey,
    storage: journalStorage,
    retain: event => event.type === 'NodeMasterySet',
  });
  const journalStore = new EventStore<GraphState>(() => ({ nodesById: {} }), journalPersistence);
  for (let index = 0; index < 70; index += 1) {
    journalStore.append(masteryEvent(`mastery-${index}`, `knowledge-${index % 7}`, index % 3 === 0 ? 'mastered' : 'touched'));
  }
  const marker = JSON.parse(journalStorage.getItem(journalKey) ?? '{}') as { schemaVersion?: number; format?: string; chunkCount?: number; chunkSize?: number };
  assert(marker.schemaVersion === 2 && marker.format === 'chunked-journal', 'personal writes must use the chunked journal');
  assert(marker.chunkCount === 3 && marker.chunkSize === 32, '70 audit events must be split into bounded 32-event chunks');
  for (let index = 0; index < 3; index += 1) {
    const chunk = JSON.parse(journalStorage.getItem(`${journalKey}.chunk.v2.${index}`) ?? '{}') as { events?: DomainEvent[] };
    assert(Array.isArray(chunk.events) && chunk.events.length > 0 && chunk.events.length <= 32, 'no personal write chunk may grow with the full audit history');
  }
  const journalReload = new FilteredKnowledgePersistence<DomainEvent>({
    storageKey: journalKey,
    storage: journalStorage,
    retain: event => event.type === 'NodeMasterySet',
  }).loadLocal();
  assert(journalReload.length === 70, 'chunked journal must preserve the complete personal audit history across reload');
  assert(journalReload[0]?.id === 'mastery-0' && journalReload[69]?.id === 'mastery-69', 'chunked journal must preserve personal event order');

  // Clearing personal persistence must not cause the untouched legacy mixed cache
  // to resurrect old mastery on the next boot.
  personalPersistence.clearLocal();
  const afterClear = new FilteredKnowledgePersistence<DomainEvent>({
    storageKey: personalKey,
    legacyStorageKey: legacyKey,
    storage,
    retain: event => event.type === 'NodeMasterySet',
  }).loadLocal();
  assert(afterClear.length === 0, 'explicitly cleared personal state must stay cleared even when legacy audit data remains read-only');
  assert(storage.getItem(legacyKey) === legacyRawBefore, 'clearing current personal state must still leave the legacy mixed cache untouched');
}
