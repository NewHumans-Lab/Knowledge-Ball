import { strict as assert } from 'node:assert';
import type { DomainEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import { executeKnowledgeOptimization, KnowledgeOptimizationValidationError } from '../command/KnowledgeOptimization';
import { executeKnowledgeOpposition, KnowledgeOppositionValidationError } from '../command/KnowledgeOpposition';
import { lineageRoleFor, stableLineageChain, topicIdFor } from '../domain/KnowledgeLineage';

class MemoryPersistence implements EventPersistence {
  events: DomainEvent[] = [];
  loadLocal(): DomainEvent[] { return structuredClone(this.events); }
  saveLocal(events: DomainEvent[]): void { this.events = structuredClone(events); }
}

function boot(persistence: MemoryPersistence) {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(
    () => structuredClone(projection.state),
    persistence,
    event => validateDomainEventAgainstState(event, projection.state),
  );
  store.subscribe(event => projection.apply(event));
  return { store, projection };
}

function importVerified(runtime: ReturnType<typeof boot>, id: string, title: string, reasoning: string): void {
  runtime.store.append({
    id: `import-${id}`,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      nodeId: id,
      title,
      nodeType: 'theorem',
      reasoning,
      premises: [],
      initialStatus: 'verified',
      source: 'import',
      declaredLayer: 'middle',
    },
  });
}

function finalize(runtime: ReturnType<typeof boot>, nodeId: string, verdict: 'CORRECT' | 'INCORRECT'): void {
  runtime.store.append({
    id: `verdict-${nodeId}-${verdict}`,
    type: 'KnowledgeVerdictFinalized',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `round-${nodeId}`,
      nodeId,
      verdict,
      closeReason: 'THRESHOLD',
      agreeCount: verdict === 'CORRECT' ? 1 : 0,
      disagreeCount: verdict === 'INCORRECT' ? 1 : 0,
      requiredVotes: 1,
      policyVersion: 'ORIGINAL_DESIGN_V2',
    },
  });
}

async function run(): Promise<void> {
  const persistence = new MemoryPersistence();
  let runtime = boot(persistence);
  importVerified(runtime, 'a1', 'A original', 'A viewpoint version one');
  importVerified(runtime, 'reserved', 'Reserved title', 'Unrelated knowledge');

  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'a1', candidateId: 'a2', title: 'A improved', reasoning: 'A viewpoint version two', declaredLayer: 'middle',
  });
  finalize(runtime, 'a2', 'CORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'current');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicIdFor(runtime.projection.state.nodesById.a2), 'history').map(n => n.id),
    ['a1'],
  );

  await assert.rejects(
    executeKnowledgeOpposition(runtime.store, runtime.projection, {
      targetId: 'a2', candidateId: 'bad-name', title: 'Reserved title', reasoning: 'Duplicate opposing title', declaredLayer: 'outer',
    }),
    KnowledgeOppositionValidationError,
    'opposition must still reject a duplicate title owned by another topic',
  );

  // Same-topic same-name opposition is legal. The UI lineage projection, not the
  // immutable title, is responsible for x2.x disambiguation.
  await executeKnowledgeOpposition(runtime.store, runtime.projection, {
    targetId: 'a2', candidateId: 'same-name-opposition', title: 'A improved', reasoning: 'Same-topic duplicate title', declaredLayer: 'outer',
  });
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById['same-name-opposition']), 'candidate-opposition');
  finalize(runtime, 'same-name-opposition', 'INCORRECT');
  assert.equal(runtime.projection.state.nodesById['same-name-opposition'], undefined, 'failed same-name opposition is still removed normally');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'current');

  await executeKnowledgeOpposition(runtime.store, runtime.projection, {
    targetId: 'a2', candidateId: 'b-rejected', title: 'B rejected', reasoning: 'A rejected opposing viewpoint', declaredLayer: 'outer',
  });
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById['b-rejected']), 'candidate-opposition');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'current', 'pending opposition cannot change the current head');
  finalize(runtime, 'b-rejected', 'INCORRECT');
  assert.equal(runtime.projection.state.nodesById['b-rejected'], undefined, 'failed opposition proposal must disappear instead of becoming rejected Knowledge');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'current', 'failed opposition leaves the accepted side untouched');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'history');

  await executeKnowledgeOpposition(runtime.store, runtime.projection, {
    targetId: 'a2', candidateId: 'b1', title: 'B viewpoint', reasoning: 'Winning opposing viewpoint', declaredLayer: 'outer',
  });
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.b1), 'candidate-opposition');
  assert.deepEqual(runtime.projection.state.nodesById.b1.premises, runtime.projection.state.nodesById.a2.premises, 'opposition inherits structural premises');
  assert.equal(runtime.projection.state.nodesById.b1.type, runtime.projection.state.nodesById.a2.type, 'opposition form cannot mutate structural node type');

  await assert.rejects(
    executeKnowledgeOptimization(runtime.store, runtime.projection, {
      targetId: 'a2', candidateId: 'race-opt', title: 'A race', reasoning: 'Must not race opposition', declaredLayer: 'middle',
    }),
    KnowledgeOptimizationValidationError,
    'optimization and opposition must not race the same current head',
  );
  await assert.rejects(
    executeKnowledgeOpposition(runtime.store, runtime.projection, {
      targetId: 'a2', candidateId: 'race-opp', title: 'B race', reasoning: 'Must not fork red candidates', declaredLayer: 'outer',
    }),
    KnowledgeOppositionValidationError,
    'two opposition candidates must not fork the viewpoint chain',
  );

  finalize(runtime, 'b1', 'CORRECT');
  const topicId = topicIdFor(runtime.projection.state.nodesById.b1);
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.b1), 'current');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'opposition').map(n => [n.id, n.lineage?.rank]),
    [['a2', 1], ['a1', 2]],
    'old current and its complete history must become one ordered opposition chain',
  );
  assert.deepEqual(stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history'), []);
  assert.equal(runtime.projection.state.nodesById.a2.reasoning, 'A viewpoint version two', 'viewpoint flip cannot rewrite old claim content');

  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'b1', candidateId: 'b2', title: 'B viewpoint', reasoning: 'B viewpoint optimized', declaredLayer: 'middle',
  });
  finalize(runtime, 'b2', 'CORRECT');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history').map(n => [n.id, n.lineage?.rank]),
    [['b1', 1]],
    'ordinary optimization on the winning side creates its gray history without disturbing red opposition',
  );
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'opposition').map(n => [n.id, n.lineage?.rank]),
    [['a2', 1], ['a1', 2]],
  );

  await executeKnowledgeOpposition(runtime.store, runtime.projection, {
    targetId: 'b2', candidateId: 'a3', title: 'A returns', reasoning: 'A-side viewpoint wins again', declaredLayer: 'middle',
  });
  finalize(runtime, 'a3', 'CORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a3), 'current');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history').map(n => [n.id, n.lineage?.rank]),
    [['a2', 1], ['a1', 2]],
    'the former red A chain must become gray history when the A side wins again',
  );
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'opposition').map(n => [n.id, n.lineage?.rank]),
    [['b2', 1], ['b1', 2]],
    'the former B current and B history must become the new ordered red chain',
  );

  const eventCount = runtime.store.size();
  runtime = boot(persistence);
  assert.equal(runtime.store.size(), eventCount, 'replay must not duplicate opposition events');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a3), 'current');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history').map(n => [n.id, n.lineage?.rank]),
    [['a2', 1], ['a1', 2]],
    'gray side must survive deterministic event replay',
  );
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'opposition').map(n => [n.id, n.lineage?.rank]),
    [['b2', 1], ['b1', 2]],
    'red side must survive deterministic event replay',
  );
  assert.equal(runtime.projection.state.nodesById['b-rejected'], undefined, 'failed opposition stays absent after deterministic replay');
  assert.equal(runtime.projection.state.nodesById['same-name-opposition'], undefined, 'failed same-name opposition stays absent after deterministic replay');

  console.log('Knowledge opposition regression tests passed');
}

void run();