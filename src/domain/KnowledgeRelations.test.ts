import { strict as assert } from 'node:assert';
import type { KnowledgeRelationNode } from './KnowledgeRelations';
import { buildKnowledgeRelations, collectKnowledgeChainEdges } from './KnowledgeRelations';

function node(
  id: string,
  title: string,
  premises: string[] = [],
  lineage?: KnowledgeRelationNode['lineage'],
): KnowledgeRelationNode {
  return { id, title, premises, lineage };
}

const nodes: KnowledgeRelationNode[] = [
  node('premise-a', 'Premise A'),
  node('premise-b', 'Premise B'),
  node('reasoning-1', 'Reasoning Process 1', ['premise-a', 'premise-b']),
  node('conclusion-1', 'Conclusion 1', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'new', role: 'current', rank: 0 }),
  node('reasoning-2', 'Reasoning Process 2', ['conclusion-1']),
  node('conclusion-2', 'Conclusion 2', ['reasoning-2']),
  node('conclusion-1-old', 'Conclusion 1 old', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'optimization', targetId: 'conclusion-1', role: 'history', rank: 1 }),
  node('conclusion-1-older', 'Conclusion 1 older', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'optimization', targetId: 'conclusion-1-old', role: 'history', rank: 2 }),
  node('conclusion-1-opposition', 'Conclusion 1 opposition', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'opposition', targetId: 'conclusion-1', role: 'opposition', rank: 1 }),
];

const reasoning = buildKnowledgeRelations('reasoning-1', nodes);
assert.deepEqual(reasoning.previous.map(item => item.id), ['premise-a', 'premise-b'], 'a reasoning-process node sees its real premises on the left');
assert.deepEqual(reasoning.next.map(item => item.id), ['conclusion-1'], 'a reasoning-process node sees its real conclusion on the right');

const conclusion = buildKnowledgeRelations('conclusion-1', nodes);
assert.deepEqual(conclusion.previous.map(item => item.id), ['reasoning-1'], 'a conclusion sees the reasoning-process ball itself on the left');
assert.deepEqual(conclusion.next.map(item => item.id), ['reasoning-2'], 'a conclusion used later sees the next reasoning-process ball on the right');
assert.deepEqual(conclusion.history.map(item => item.id), ['conclusion-1-old', 'conclusion-1-older'], 'history stays on the top axis nearest-first');
assert.deepEqual(conclusion.opposition.map(item => item.id), ['conclusion-1-opposition'], 'opposition history stays on the bottom axis');

const secondReasoning = buildKnowledgeRelations('reasoning-2', nodes);
assert.deepEqual(secondReasoning.previous.map(item => item.id), ['conclusion-1']);
assert.deepEqual(secondReasoning.next.map(item => item.id), ['conclusion-2']);

const edges = collectKnowledgeChainEdges(nodes);
assert.deepEqual(edges, [
  { fromId: 'premise-a', toId: 'reasoning-1' },
  { fromId: 'premise-b', toId: 'reasoning-1' },
  { fromId: 'reasoning-1', toId: 'conclusion-1' },
  { fromId: 'conclusion-1', toId: 'reasoning-2' },
  { fromId: 'reasoning-2', toId: 'conclusion-2' },
], 'live horizontal lines are only the real current-node reasoning chain; history/opposition are not duplicate horizontal edges');

for (const edge of edges) {
  const from = buildKnowledgeRelations(edge.fromId, nodes);
  const to = buildKnowledgeRelations(edge.toId, nodes);
  assert.ok(from.next.some(item => item.id === edge.toId), `scene edge ${edge.fromId}->${edge.toId} must exist as a right-side detail relation`);
  assert.ok(to.previous.some(item => item.id === edge.fromId), `scene edge ${edge.fromId}->${edge.toId} must exist as a left-side detail relation`);
}

assert.deepEqual(buildKnowledgeRelations('missing', nodes), {
  previous: [], next: [], history: [], opposition: [],
});

console.log('Canonical four-direction knowledge relation tests passed');
