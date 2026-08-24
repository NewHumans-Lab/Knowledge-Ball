import { strict as assert } from 'node:assert';
import type { GraphNode } from '../graph/Node';
import { promoteOppositionCandidate } from './KnowledgeOpposition';
import {
  currentNodeForTopic,
  initialLineage,
  lineageRoleFor,
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

const suppressed: KnowledgeLineageNode[] = [
  {
    id: 'reason-old',
    lineage: {
      topicId: 'reason-topic',
      proposal: 'new',
      role: 'history',
      rank: 1,
      suppressedByOpposition: true,
    },
  },
  {
    id: 'reason-no',
    lineage: {
      topicId: 'reason-topic',
      proposal: 'opposition',
      targetId: 'reason-old',
      role: 'opposition',
      rank: 1,
      suppressedByOpposition: true,
    },
  },
];
assert.deepEqual(validateKnowledgeLineage(suppressed), [], 'accepted reasoning opposition may intentionally leave no current white head');
assert.equal(currentNodeForTopic(suppressed, 'reason-topic'), undefined);

const partiallySuppressed = structuredClone(suppressed);
partiallySuppressed[0]!.lineage!.suppressedByOpposition = false;
assert.ok(validateKnowledgeLineage(partiallySuppressed).some(error => error.includes('mark every active member')));

const reasoningNodes: GraphNode[] = [
  {
    id: 'r1',
    title: 'Reasoning link',
    type: 'reasoning',
    status: 'verified',
    mastery: 'none',
    reasoning: 'P therefore Q',
    premises: [],
    hidden: false,
    lineage: { topicId: 'r1', proposal: 'new', role: 'current', rank: 0 },
  },
  {
    id: 'r2',
    title: 'This reasoning should not exist',
    type: 'reasoning',
    status: 'pending',
    mastery: 'none',
    reasoning: 'The inference is invalid',
    premises: [],
    hidden: false,
    lineage: { topicId: 'r1', proposal: 'opposition', targetId: 'r1', role: 'candidate-opposition', rank: 0 },
  },
];
promoteOppositionCandidate(reasoningNodes, 'r2');
assert.equal(lineageRoleFor(reasoningNodes[0]!), 'history', 'former white reasoning must become gray history');
assert.equal(lineageRoleFor(reasoningNodes[1]!), 'opposition', 'winning reasoning opposition must stay red');
assert.equal(reasoningNodes[0]!.lineage?.suppressedByOpposition, true);
assert.equal(reasoningNodes[1]!.lineage?.suppressedByOpposition, true);
assert.equal(reasoningNodes[0]!.hidden, true);
assert.equal(reasoningNodes[1]!.hidden, true);
assert.equal(reasoningNodes[1]!.status, 'verified');
assert.equal(currentNodeForTopic(reasoningNodes, 'r1'), undefined, 'suppressed reasoning has no effective current node');
assert.deepEqual(validateKnowledgeLineage(reasoningNodes), []);

console.log('Knowledge lineage domain regression tests passed');
