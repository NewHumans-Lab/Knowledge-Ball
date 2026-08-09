import { EventStore, type EventPersistence } from '../event/EventStore';
import { GraphProjection } from '../projection/GraphProjection';
import { createNode } from '../command/CreateNode';
import { editNode } from '../command/EditNode';
import { resolveNode } from '../command/ResolveNode';
import { setMastery } from '../command/SetMastery';
import type { DomainEvent } from '../event/Event';
import type { GraphState } from '../state/GraphState';

class MemoryPersistence implements EventPersistence {
  events: DomainEvent[] = [];
  loadLocal(): DomainEvent[] { return structuredClone(this.events); }
  saveLocal(events: DomainEvent[]): void { this.events = structuredClone(events); }
}

function boot(persistence: MemoryPersistence): { store: EventStore<GraphState>; projection: GraphProjection } {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(() => structuredClone(projection.state), persistence);
  store.subscribe(event => projection.apply(event));
  return { store, projection };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function runPersistenceRegression(): Promise<void> {
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
}
