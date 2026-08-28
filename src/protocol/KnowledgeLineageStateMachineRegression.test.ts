import { strict as assert } from 'node:assert';
import type { DomainEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import { executeKnowledgeOptimization } from '../command/KnowledgeOptimization';
import { executeKnowledgeOpposition } from '../command/KnowledgeOpposition';
import { lineageRoleFor, topicIdFor } from '../domain/KnowledgeLineage';

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

function importVerified(runtime: ReturnType<typeof boot>, id: string, title: string, premises: string[] = []): void {
  runtime.store.append({
    id: `import:${id}`,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      nodeId: id,
      title,
      nodeType: 'theorem',
      reasoning: `${title} content`,
      premises,
      initialStatus: 'verified',
      source: 'import',
      declaredLayer: 'middle',
    },
  });
}

function finalizePending(
  runtime: ReturnType<typeof boot>,
  nodeId: string,
  verdict: 'CORRECT' | 'INCORRECT',
  policyVersion: 'ORIGINAL_DESIGN_V1' | 'ORIGINAL_DESIGN_V2' = 'ORIGINAL_DESIGN_V2',
): void {
  runtime.store.append({
    id: `verdict:${policyVersion}:${nodeId}:${verdict}:${runtime.store.size()}`,
    type: 'KnowledgeVerdictFinalized',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `round:${nodeId}:${runtime.store.size()}`,
      nodeId,
      verdict,
      closeReason: 'THRESHOLD',
      agreeCount: verdict === 'CORRECT' ? 1 : 0,
      disagreeCount: verdict === 'INCORRECT' ? 1 : 0,
      requiredVotes: 1,
      policyVersion,
    },
  });
}

function changeStatus(
  runtime: ReturnType<typeof boot>,
  nodeId: string,
  status: 'disputed' | 'verified' | 'suspended',
  causeNodeId: string,
): void {
  runtime.store.append({
    id: `status:${nodeId}:${status}:${runtime.store.size()}`,
    type: 'KnowledgeStatusChanged',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: { edit: { kind: 'status', nodeId, status, causeNodeId } },
  });
}

function startGrayRevalidation(runtime: ReturnType<typeof boot>, nodeId: string): void {
  const topicId = topicIdFor(runtime.projection.state.nodesById[nodeId]);
  runtime.store.append({
    id: `revalidation:start:${nodeId}`,
    type: 'KnowledgeRevalidationStarted',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `revalidation:${nodeId}`,
      nodeId,
      topicId,
      roleAtStart: 'history',
      stage: 0,
      stake: '10',
      scope: 'GLOBAL',
      requiredVotes: 1,
      deadline: new Date(Date.now() + 720 * 60 * 60 * 1000).toISOString(),
      policyVersion: 'ORIGINAL_DESIGN_V1',
    },
  });
}

function finishGrayRevalidation(runtime: ReturnType<typeof boot>, nodeId: string): void {
  const topicId = topicIdFor(runtime.projection.state.nodesById[nodeId]);
  runtime.store.append({
    id: `revalidation:finish:${nodeId}`,
    type: 'KnowledgeRevalidationFinalized',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `revalidation:${nodeId}`,
      nodeId,
      topicId,
      verdict: 'CORRECT',
      closeReason: 'THRESHOLD',
      agreeCount: 1,
      disagreeCount: 0,
      requiredVotes: 1,
      stage: 0,
      policyVersion: 'ORIGINAL_DESIGN_V1',
    },
  });
}

async function run(): Promise<void> {
  const persistence = new MemoryPersistence();
  let runtime = boot(persistence);
  importVerified(runtime, 'a1', 'A original');
  importVerified(runtime, 'downstream', 'Depends on A', ['a1']);

  // Failed optimization: immutable current head remains authoritative and the
  // failed Proposal disappears after its energy settlement.
  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'a1', candidateId: 'a-fail', title: 'A original', reasoning: 'Rejected improvement', declaredLayer: 'middle',
  });
  assert.equal(runtime.projection.state.nodesById['a-fail'].status, 'pending');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'current');
  finalizePending(runtime, 'a-fail', 'INCORRECT');
  assert.equal(runtime.projection.state.nodesById['a-fail'], undefined, 'failed optimization proposal disappears after settlement');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'current');

  // Successful optimization: new immutable ball becomes head; old ball is gray history.
  await executeKnowledgeOptimization(runtime.store, runtime.projection, {
    targetId: 'a1', candidateId: 'a2', title: 'A improved', reasoning: 'Accepted improvement', declaredLayer: 'middle',
  });
  finalizePending(runtime, 'a2', 'CORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'current');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'history');
  assert.equal(runtime.projection.state.nodesById.a1.reasoning, 'A original content');

  // Server cascade: V1 pending-vote verdict is a re-review result, not a truth
  // verdict. INCORRECT must remain disputed until the authoritative status event
  // moves the node to suspended; it must never become falsified/hidden here.
  changeStatus(runtime, 'downstream', 'disputed', 'a1');
  assert.equal(runtime.projection.state.nodesById.downstream.status, 'disputed');
  finalizePending(runtime, 'downstream', 'INCORRECT', 'ORIGINAL_DESIGN_V1');
  assert.equal(runtime.projection.state.nodesById.downstream.status, 'disputed');
  assert.equal(runtime.projection.state.nodesById.downstream.hidden, false);
  changeStatus(runtime, 'downstream', 'suspended', 'a1');
  assert.equal(runtime.projection.state.nodesById.downstream.status, 'suspended');
  assert.equal(runtime.projection.state.nodesById.downstream.hidden, false);

  // Successful cascade similarly waits for the authoritative status event.
  changeStatus(runtime, 'downstream', 'disputed', 'a1');
  finalizePending(runtime, 'downstream', 'CORRECT', 'ORIGINAL_DESIGN_V1');
  assert.equal(runtime.projection.state.nodesById.downstream.status, 'disputed');
  changeStatus(runtime, 'downstream', 'verified', 'a1');
  assert.equal(runtime.projection.state.nodesById.downstream.status, 'verified');

  // Old gray ball can win the frozen V1 revalidation and become current again.
  startGrayRevalidation(runtime, 'a1');
  assert.equal(runtime.projection.state.nodesById.a1.status, 'disputed');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'history');
  finishGrayRevalidation(runtime, 'a1');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'current');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a2), 'history');

  // Successful opposition swaps viewpoint only after its first-round verdict.
  await executeKnowledgeOpposition(runtime.store, runtime.projection, {
    targetId: 'a1', candidateId: 'b1', title: 'B viewpoint', reasoning: 'Opposing claim', declaredLayer: 'outer',
  });
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.b1), 'candidate-opposition');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'current');
  finalizePending(runtime, 'b1', 'CORRECT');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.b1), 'current');
  assert.equal(lineageRoleFor(runtime.projection.state.nodesById.a1), 'opposition');

  // Full event replay must reproduce the same head/history/opposition/status state.
  const finalState = structuredClone(runtime.projection.state);
  const eventCount = runtime.store.size();
  runtime = boot(persistence);
  assert.equal(runtime.store.size(), eventCount);
  assert.deepEqual(runtime.projection.state, finalState);

  console.log('Knowledge lineage end-to-end state machine regression tests passed');
}

void run();
