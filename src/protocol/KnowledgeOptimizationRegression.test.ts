import { strict as assert } from 'node:assert';
import type { DomainEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import {
  executeKnowledgeOptimization,
  KnowledgeOptimizationValidationError,
} from '../command/KnowledgeOptimization';
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
  importVerified(runtime, 'v1', 'Shared title', 'Original immutable content');
  importVerified(runtime, 'other', 'Reserved title', 'Another knowledge topic');

  const event = await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'v1',
    candidateId: 'v2-rejected',
    title: 'Shared title',
    reasoning: 'Candidate content that will fail validation',
    declaredLayer: 'outer',
  });
  assert.equal(event.type, 'KnowledgeAdded');
  assert.equal(event.payload.optimization?.targetId, 'v1');
  assert.equal(runtime.projection.state.nodesById.v1.reasoning, 'Original immutable content', 'optimization must never mutate target content');
  assert.equal(runtime.projection.state.nodesById['v2-rejected'].type, 'theorem', 'candidate inherits structural node type');
  assert.deepEqual(runtime.projection.state.nodesById['v2-rejected'].premises, [], 'candidate inherits target premises');
  assert.equal(runtime.projection.state.nodesById['v2-rejected'].declaredLayer, 'outer', 'layer is the only structural classification the author may change');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.v1), 'current');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById['v2-rejected']), 'candidate-history');

  await assert.rejects(
    executeKnowledgeOptimization(runtime.store, runtime.projection, {
      targetId: 'v1', candidateId: 'parallel', title: 'Shared title', reasoning: 'Parallel candidate', declaredLayer: 'middle',
    }),
    KnowledgeOptimizationValidationError,
    'one topic must not fork into concurrent optimization candidates',
  );

  finalize(runtime, 'v2-rejected', 'INCORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById['v2-rejected']), 'rejected');
  assert.equal(runtime.projection.state.nodesById['v2-rejected'].hidden, true);
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.v1), 'current', 'failed optimization must not move the current head');

  await assert.rejects(
    executeKnowledgeOptimization(runtime.store, runtime.projection, {
      targetId: 'v1', candidateId: 'bad-name', title: 'Reserved title', reasoning: 'Would collide with another topic', declaredLayer: 'middle',
    }),
    KnowledgeOptimizationValidationError,
    'renaming during optimization must still respect global title uniqueness',
  );

  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'v1',
    candidateId: 'v2',
    title: 'Shared title',
    reasoning: 'Improved immutable content',
    declaredLayer: 'middle',
  });
  finalize(runtime, 'v2', 'CORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.v2), 'current');
  assert.equal(runtime.projection.state.nodesById.v2.status, 'verified');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.v1), 'history');
  assert.equal(runtime.projection.state.nodesById.v1.lineage?.rank, 1);
  assert.equal(runtime.projection.state.nodesById.v1.hidden, true, 'stable history leaves the default graph until lineage view is implemented');
  assert.equal(runtime.projection.state.nodesById.v1.reasoning, 'Original immutable content', 'promotion cannot rewrite old version content');

  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'v2',
    candidateId: 'v3',
    title: 'Renamed current knowledge',
    reasoning: 'Third immutable version',
    declaredLayer: 'inner',
  });
  finalize(runtime, 'v3', 'CORRECT');
  const topicId = topicIdFor(runtime.projection.state.nodesById.v3);
  const history = stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history');
  assert.deepEqual(history.map(node => [node.id, node.lineage?.rank]), [['v2', 1], ['v1', 2]], 'nearest previous version must remain first in a strictly linear chain');
  assert.equal(runtime.projection.state.nodesById.v3.declaredLayer, 'inner');
  assert.equal(runtime.projection.state.nodesById.v2.title, 'Shared title', 'renaming V3 must not rewrite V2');

  const eventCount = runtime.store.size();
  runtime = boot(persistence);
  assert.equal(runtime.store.size(), eventCount, 'replay must not duplicate optimization events');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.v3), 'current', 'current head must survive event replay');
  assert.deepEqual(
    stableLineageChain(Object.values(runtime.projection.state.nodesById), topicId, 'history').map(node => [node.id, node.lineage?.rank]),
    [['v2', 1], ['v1', 2]],
    'linear version ordering must survive event replay',
  );
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById['v2-rejected']), 'rejected', 'failed candidate remains audit-only after replay');

  console.log('Knowledge optimization regression tests passed');
}

void run();
