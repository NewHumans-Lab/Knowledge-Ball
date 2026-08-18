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
  const publicEvent: DomainEvent = {
    id: 'legacy-public',
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: 1,
    payload: { nodeId: 'legacy-node', title: 'Legacy', nodeType: 'fact', reasoning: '', premises: [], source: 'import' },
  };
  const masteryEvent: DomainEvent = {
    id: 'legacy-mastery',
    type: 'NodeMasterySet',
    scope: 'personal',
    schemaVersion: 1,
    timestamp: 2,
    payload: { nodeId: 'legacy-node', mastery: 'mastered' },
  };
  const legacyPersistence = new KnowledgePersistence<DomainEvent>({ storageKey: legacyKey, storage });
  legacyPersistence.saveLocal([publicEvent, masteryEvent]);
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
  assert(personalPersistence.shouldPersist(masteryEvent) === true, 'personal mastery remains locally persistable in this phase');

  personalPersistence.saveLocal([publicEvent, masteryEvent]);
  const currentSaved = new KnowledgePersistence<DomainEvent>({ storageKey: personalKey, storage }).loadLocal();
  assert(currentSaved.length === 1 && currentSaved[0]?.type === 'NodeMasterySet', 'new persistence key must contain personal events only');
}
