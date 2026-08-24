import { strict as assert } from 'node:assert';
import type { GraphNode } from '../graph/Node';
import { promoteOppositionCandidate } from './KnowledgeOpposition';
import { promoteOptimizationCandidate } from './KnowledgeOptimization';
import {
  currentNodeForTopic,
  dominantNodeForTopic,
  initialLineage,
  lineageRoleFor,
  reasoningHeadForTopic,
  reasoningHistoryChain,
  stableLineageChain,
  topicIdFor,
  validateKnowledgeLineage,
  type KnowledgeLineageNode,
} from './KnowledgeLineage';

const legacy: KnowledgeLineageNode = { id: 'legacy' };
assert.equal(topicIdFor(legacy), 'legacy');
assert.equal(lineageRoleFor(legacy), 'current');
assert.deepEqual(initialLineage('first'), {
  topicId: 'first',
  proposal: 'new',
  role: 'current',
  rank: 0,
});

const valid: KnowledgeLineageNode[] = [
  { id: 'a3', lineage: { topicId: 'topic-a', proposal: 'optimization', targetId: 'a2', role: 'current', rank: 0 } },
  { id: 'a2', lineage: { topicId: 'topic-a', proposal: 'optimization', targetId: 'a1', role: 'history', rank: 1 } },
  { id: 'a1', lineage: { topicId: 'topic-a', proposal: 'new', role: 'history', rank: 2 } },
  { id: 'b2', lineage: { topicId: 'topic-a', proposal: 'opposition', targetId: 'a3', role: 'opposition', rank: 1 } },
  { id: 'b1', lineage: { topicId: 'topic-a', proposal: 'opposition', targetId: 'a3', role: 'opposition', rank: 2 } },
  { id: 'a4-pending', lineage: { topicId: 'topic-a', proposal: 'optimization', targetId: 'a3', role: 'candidate-history', rank: 0 } },
];
assert.deepEqual(validateKnowledgeLineage(valid), []);
assert.equal(currentNodeForTopic(valid, 'topic-a')?.id, 'a3');
assert.deepEqual(stableLineageChain(valid, 'topic-a', 'history').map(node => node.id), ['a2', 'a1']);
assert.deepEqual(stableLineageChain(valid, 'topic-a', 'opposition').map(node => node.id), ['b2', 'b1']);

const duplicateCurrent = structuredClone(valid);
duplicateCurrent.push({ id: 'a0-current', lineage: { topicId: 'topic-a', proposal: 'new', role: 'current', rank: 0 } });
assert.ok(validateKnowledgeLineage(duplicateCurrent).some(error => error.includes('exactly one current')));

const forkedHistory = structuredClone(valid);
forkedHistory.push({ id: 'a2-fork', lineage: { topicId: 'topic-a', proposal: 'optimization', targetId: 'a3', role: 'history', rank: 1 } });
assert.ok(validateKnowledgeLineage(forkedHistory).some(error => error.includes('history lineage cannot fork')));

const forkedOpposition = structuredClone(valid);
forkedOpposition.push({ id: 'b2-fork', lineage: { topicId: 'topic-a', proposal: 'opposition', targetId: 'a3', role: 'opposition', rank: 1 } });
assert.ok(validateKnowledgeLineage(forkedOpposition).some(error => error.includes('opposition lineage cannot fork')));

const missingTarget: KnowledgeLineageNode[] = [
  { id: 'head', lineage: { topicId: 'topic-x', proposal: 'new', role: 'current', rank: 0 } },
  { id: 'candidate', lineage: { topicId: 'topic-x', proposal: 'optimization', targetId: 'missing', role: 'candidate-history', rank: 0 } },
];
assert.ok(validateKnowledgeLineage(missingTarget).some(error => error.includes('target does not exist')));

const crossTopicTarget: KnowledgeLineageNode[] = [
  { id: 'head-x', lineage: { topicId: 'topic-x', proposal: 'new', role: 'current', rank: 0 } },
  { id: 'head-y', lineage: { topicId: 'topic-y', proposal: 'new', role: 'current', rank: 0 } },
  { id: 'candidate', lineage: { topicId: 'topic-x', proposal: 'optimization', targetId: 'head-y', role: 'candidate-history', rank: 0 } },
];
assert.ok(validateKnowledgeLineage(crossTopicTarget).some(error => error.includes('same topic')));

function reasoningNode(id: string, title: string, lineage: GraphNode['lineage'], status: GraphNode['status'] = 'verified'): GraphNode {
  return {
    id,
    title,
    type: 'reasoning',
    status,
    mastery: 'none',
    reasoning: title,
    premises: ['p'],
    hidden: false,
    lineage,
  };
}

// Two-camp reasoning invariant: white and red heads keep stable colors/roles;
// dominance alone decides which head is on the logical inference chain.
const reasoningNodes: GraphNode[] = [
  reasoningNode('r-white-1', 'White reasoning', { topicId: 'reason-topic', proposal: 'new', role: 'current', rank: 0 }),
  reasoningNode('r-red-1', 'Red challenge', {
    topicId: 'reason-topic', proposal: 'opposition', targetId: 'r-white-1', role: 'candidate-opposition', rank: 0,
    reasoningSide: 'opposition', reasoningSideRank: 0, reasoningDominant: false,
  }, 'pending'),
];
promoteOppositionCandidate(reasoningNodes, 'r-red-1');
assert.equal(lineageRoleFor(reasoningNodes[0]!), 'current', 'white head must stay white/current when red wins');
assert.equal(reasoningNodes[0]!.lineage?.reasoningSide, 'normal');
assert.equal(reasoningNodes[0]!.lineage?.reasoningSideRank, 0);
assert.equal(reasoningNodes[0]!.lineage?.reasoningDominant, false);
assert.equal(lineageRoleFor(reasoningNodes[1]!), 'opposition', 'winning red head must stay red/opposition');
assert.equal(reasoningNodes[1]!.lineage?.reasoningSideRank, 0);
assert.equal(reasoningNodes[1]!.lineage?.reasoningDominant, true);
assert.equal(currentNodeForTopic(reasoningNodes, 'reason-topic')?.id, 'r-white-1');
assert.equal(dominantNodeForTopic(reasoningNodes, 'reason-topic')?.id, 'r-red-1');
assert.deepEqual(validateKnowledgeLineage(reasoningNodes), []);

// White can optimize independently while red remains dominant.
reasoningNodes.push(reasoningNode('r-white-2', 'White reasoning v2', {
  topicId: 'reason-topic', proposal: 'optimization', targetId: 'r-white-1', role: 'candidate-history', rank: 0,
  reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
}, 'pending'));
promoteOptimizationCandidate(reasoningNodes, 'r-white-2');
assert.equal(reasoningHeadForTopic(reasoningNodes, 'reason-topic', 'normal')?.id, 'r-white-2');
assert.equal(dominantNodeForTopic(reasoningNodes, 'reason-topic')?.id, 'r-red-1', 'optimizing non-dominant white must not steal dominance');
assert.deepEqual(reasoningHistoryChain(reasoningNodes, 'reason-topic', 'normal').map(node => node.id), ['r-white-1']);

// Red can optimize independently; its former red head becomes gray side history.
reasoningNodes.push(reasoningNode('r-red-2', 'Red challenge v2', {
  topicId: 'reason-topic', proposal: 'optimization', targetId: 'r-red-1', role: 'candidate-history', rank: 0,
  reasoningSide: 'opposition', reasoningSideRank: 0, reasoningDominant: false,
}, 'pending'));
promoteOptimizationCandidate(reasoningNodes, 'r-red-2');
assert.equal(reasoningHeadForTopic(reasoningNodes, 'reason-topic', 'opposition')?.id, 'r-red-2');
assert.equal(dominantNodeForTopic(reasoningNodes, 'reason-topic')?.id, 'r-red-2');
assert.deepEqual(reasoningHistoryChain(reasoningNodes, 'reason-topic', 'opposition').map(node => node.id), ['r-red-1']);
assert.deepEqual(reasoningHistoryChain(reasoningNodes, 'reason-topic', 'normal').map(node => node.id), ['r-white-1']);
assert.deepEqual(validateKnowledgeLineage(reasoningNodes), []);

// Opposing the dominant red head creates a new white head and flips dominance
// back without recoloring the red head or mixing the two gray histories.
reasoningNodes.push(reasoningNode('r-white-3', 'White rebuttal', {
  topicId: 'reason-topic', proposal: 'opposition', targetId: 'r-red-2', role: 'candidate-opposition', rank: 0,
  reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
}, 'pending'));
promoteOppositionCandidate(reasoningNodes, 'r-white-3');
assert.equal(reasoningHeadForTopic(reasoningNodes, 'reason-topic', 'normal')?.id, 'r-white-3');
assert.equal(reasoningHeadForTopic(reasoningNodes, 'reason-topic', 'opposition')?.id, 'r-red-2');
assert.equal(dominantNodeForTopic(reasoningNodes, 'reason-topic')?.id, 'r-white-3');
assert.equal(reasoningNodes.find(node => node.id === 'r-red-2')?.lineage?.reasoningDominant, false);
assert.deepEqual(reasoningHistoryChain(reasoningNodes, 'reason-topic', 'normal').map(node => node.id), ['r-white-2', 'r-white-1']);
assert.deepEqual(reasoningHistoryChain(reasoningNodes, 'reason-topic', 'opposition').map(node => node.id), ['r-red-1']);
assert.deepEqual(validateKnowledgeLineage(reasoningNodes), []);

const doubleDominant = structuredClone(reasoningNodes);
const whiteHead = reasoningHeadForTopic(doubleDominant, 'reason-topic', 'normal')!;
const redHead = reasoningHeadForTopic(doubleDominant, 'reason-topic', 'opposition')!;
whiteHead.lineage!.reasoningDominant = true;
redHead.lineage!.reasoningDominant = true;
assert.ok(validateKnowledgeLineage(doubleDominant).some(error => error.includes('exactly one dominant')));

console.log('Knowledge lineage domain regression tests passed');
