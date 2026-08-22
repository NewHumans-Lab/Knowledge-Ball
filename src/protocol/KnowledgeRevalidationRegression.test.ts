import { strict as assert } from 'node:assert';
import type { DomainEvent } from '../event/Event';
import { isCanonicalPublicKnowledgeEvent } from '../event/Event';
import { validateDomainEventAgainstState } from '../event/EventValidation';
import type { GraphNode } from '../graph/Node';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import {
  beginKnowledgeRevalidation,
  canParticipateInRevalidation,
  finalizeKnowledgeRevalidation,
  nextRevalidationStage,
  revalidationRoundPolicy,
  revalidationTimeoutVerdict,
} from '../domain/KnowledgeRevalidation';
import { lineageRoleFor, stableLineageChain, topicIdFor } from '../domain/KnowledgeLineage';

function node(
  id: string,
  role: 'current' | 'history' | 'opposition',
  rank: number,
): GraphNode {
  return {
    id,
    title: id,
    type: 'theorem',
    status: 'verified',
    mastery: 'none',
    reasoning: `${id} content`,
    premises: [],
    declaredLayer: 'middle',
    hidden: role !== 'current',
    lineage: { topicId: 'topic', proposal: 'new', role, rank },
  };
}

function seededState(): GraphState {
  const nodes = [
    node('current', 'current', 0),
    node('history-1', 'history', 1),
    node('history-2', 'history', 2),
    node('opposition-1', 'opposition', 1),
    node('opposition-2', 'opposition', 2),
  ];
  return { nodesById: Object.fromEntries(nodes.map(item => [item.id, item])) };
}

function started(nodeId: string, roleAtStart: 'history' | 'opposition', stage = 0): DomainEvent {
  const policy = revalidationRoundPolicy(stage, 99);
  return {
    id: `revalidation-start:${nodeId}:${stage}`,
    type: 'KnowledgeRevalidationStarted',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `round-${nodeId}-${stage}`,
      nodeId,
      topicId: 'topic',
      roleAtStart,
      stage,
      stake: policy.stake.toString(),
      scope: policy.scope,
      accuracyGate: policy.accuracyGate,
      localHopLimit: policy.localHopLimit,
      requiredVotes: policy.requiredVotes,
      deadline: new Date(Date.now() + 720 * 60 * 60 * 1000).toISOString(),
      policyVersion: 'ORIGINAL_DESIGN_V1',
    },
  };
}

function finalized(nodeId: string, verdict: 'CORRECT' | 'INCORRECT', stage = 0): DomainEvent {
  return {
    id: `revalidation-final:${nodeId}:${stage}:${verdict}`,
    type: 'KnowledgeRevalidationFinalized',
    scope: 'public',
    schemaVersion: 1,
    timestamp: Date.now(),
    payload: {
      roundId: `round-${nodeId}-${stage}`,
      nodeId,
      topicId: 'topic',
      verdict,
      closeReason: 'THRESHOLD',
      agreeCount: verdict === 'CORRECT' ? 2 : 0,
      disagreeCount: verdict === 'INCORRECT' ? 2 : 0,
      requiredVotes: 2,
      stage,
      policyVersion: 'ORIGINAL_DESIGN_V1',
    },
  };
}

function run(): void {
  // The new adapter must exactly consume the frozen V1 challenge interpreter.
  assert.deepEqual(revalidationRoundPolicy(0, 9), {
    stage: 0, stake: 10n, scope: 'GLOBAL', requiredVotes: 1, localHopLimit: undefined,
  });
  assert.deepEqual(revalidationRoundPolicy(1, 99), {
    stage: 1, stake: 10n, scope: 'LOCAL_10', requiredVotes: 2, localHopLimit: 10,
  });
  assert.deepEqual(revalidationRoundPolicy(2, 999), {
    stage: 2, stake: 10n, scope: 'GLOBAL', accuracyGate: 50, requiredVotes: 4, localHopLimit: undefined,
  });
  assert.deepEqual(revalidationRoundPolicy(3, 9999), {
    stage: 3, stake: 10n, scope: 'LOCAL_10', accuracyGate: 50, requiredVotes: 8, localHopLimit: 10,
  });
  assert.deepEqual(revalidationRoundPolicy(32, 10000), {
    stage: 32, stake: 20n, scope: 'GLOBAL', accuracyGate: 50, requiredVotes: 16, localHopLimit: undefined,
  });
  assert.equal(revalidationRoundPolicy(302, 1).stake > 20n, true, 'challenge stake ladder must remain unbounded');

  assert.equal(nextRevalidationStage(), 0);
  assert.equal(nextRevalidationStage({ stage: 0, verdict: 'INCORRECT' }), 1, 'unchanged verdict advances to LOCAL_10');
  assert.equal(nextRevalidationStage({ stage: 31, verdict: 'INCORRECT' }), 32, 'unchanged verdict advances to next stake tier');
  assert.equal(nextRevalidationStage({ stage: 31, verdict: 'CORRECT' }), 0, 'a verdict flip resets the next challenge to stage zero');

  const global50 = revalidationRoundPolicy(2, 100);
  assert.equal(canParticipateInRevalidation(global50, { accuracyPercent: 49.99 }), false);
  assert.equal(canParticipateInRevalidation(global50, { accuracyPercent: 50 }), true);
  const local50 = revalidationRoundPolicy(3, 100);
  assert.equal(canParticipateInRevalidation(local50, { accuracyPercent: 100, localDistance: 10 }), true);
  assert.equal(canParticipateInRevalidation(local50, { accuracyPercent: 100, localDistance: 11 }), false);
  assert.equal(canParticipateInRevalidation(local50, { accuracyPercent: 100 }), false);

  // Ordinary voters follow the round stake. There is deliberately no fixed one-energy path here.
  assert.equal(revalidationRoundPolicy(0, 100).stake, 10n);
  assert.equal(revalidationRoundPolicy(32, 100).stake, 20n);

  // The initiator position is excluded from early threshold counts but is added at timeout.
  assert.deepEqual(revalidationTimeoutVerdict(0, 0), { verdict: 'CORRECT', tied: false });
  assert.deepEqual(revalidationTimeoutVerdict(0, 1), { verdict: 'PENDING', tied: true });
  assert.deepEqual(revalidationTimeoutVerdict(1, 1), { verdict: 'CORRECT', tied: false });

  // Gray reactivation keeps its role/color until final success.
  const gray = Object.values(seededState().nodesById);
  assert.equal(beginKnowledgeRevalidation(gray, 'history-1'), 'history');
  assert.equal(gray.find(n => n.id === 'history-1')?.status, 'disputed');
  assert.equal(lineageRoleFor(gray.find(n => n.id === 'history-1')!), 'history');
  finalizeKnowledgeRevalidation(gray, 'history-1', 'INCORRECT');
  assert.equal(gray.find(n => n.id === 'history-1')?.status, 'verified');
  assert.equal(lineageRoleFor(gray.find(n => n.id === 'history-1')!), 'history');
  assert.equal(lineageRoleFor(gray.find(n => n.id === 'current')!), 'current');

  beginKnowledgeRevalidation(gray, 'history-1');
  finalizeKnowledgeRevalidation(gray, 'history-1', 'CORRECT');
  assert.equal(lineageRoleFor(gray.find(n => n.id === 'history-1')!), 'current');
  assert.deepEqual(
    stableLineageChain(gray, 'topic', 'history').map(n => [n.id, n.lineage?.rank]),
    [['current', 1], ['history-2', 2]],
  );

  // Red reactivation performs the viewpoint swap only after final success.
  const redState = seededState();
  const redProjection = new GraphProjection();
  redProjection.reset(structuredClone(redState));
  const start = started('opposition-1', 'opposition');
  assert.deepEqual(validateDomainEventAgainstState(start, redProjection.state), []);
  assert.equal(isCanonicalPublicKnowledgeEvent(start), false, 'server revalidation events must never become client-writable');
  redProjection.apply(start);
  assert.equal(redProjection.state.nodesById['opposition-1'].status, 'disputed');
  assert.equal(lineageRoleFor(redProjection.state.nodesById['opposition-1']), 'opposition');
  assert.equal(lineageRoleFor(redProjection.state.nodesById.current), 'current');

  const finish = finalized('opposition-1', 'CORRECT');
  assert.deepEqual(validateDomainEventAgainstState(finish, redProjection.state), []);
  redProjection.apply(finish);
  assert.equal(lineageRoleFor(redProjection.state.nodesById['opposition-1']), 'current');
  assert.deepEqual(
    stableLineageChain(Object.values(redProjection.state.nodesById), 'topic', 'history').map(n => [n.id, n.lineage?.rank]),
    [['opposition-2', 1]],
  );
  assert.deepEqual(
    stableLineageChain(Object.values(redProjection.state.nodesById), 'topic', 'opposition').map(n => [n.id, n.lineage?.rank]),
    [['current', 1], ['history-1', 2], ['history-2', 3]],
  );

  // Replaying the same authoritative lifecycle from the same seed is deterministic.
  const replay = new GraphProjection();
  replay.reset(structuredClone(redState));
  replay.apply(start);
  replay.apply(finish);
  assert.deepEqual(replay.state, redProjection.state);
  assert.equal(topicIdFor(replay.state.nodesById['opposition-1']), 'topic');

  // Invalid role-at-start is rejected before it can mutate projection state.
  const malformed = started('history-1', 'opposition');
  assert.notDeepEqual(validateDomainEventAgainstState(malformed, redState), []);

  console.log('Knowledge revalidation regression tests passed');
}

run();
