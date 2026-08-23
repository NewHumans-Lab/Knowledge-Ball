import { strict as assert } from 'node:assert';
import type { KnowledgeRelationNode, KnowledgeRelations } from './KnowledgeRelations';
import { buildKnowledgeRelations, collectKnowledgeChainEdges } from './KnowledgeRelations';

function node(
  id: string,
  title: string,
  premises: string[] = [],
  lineage?: KnowledgeRelationNode['lineage'],
): KnowledgeRelationNode {
  return { id, title, premises, lineage };
}

function allRelatedIds(relations: KnowledgeRelations): string[] {
  return Object.values(relations).flatMap(items => items.map(item => item.id));
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
  node('conclusion-1-opposition-older', 'Conclusion 1 older opposition', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'opposition', targetId: 'conclusion-1-opposition', role: 'opposition', rank: 2 }),
  node('conclusion-1-candidate-history', 'Conclusion 1 candidate history', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'optimization', targetId: 'conclusion-1', role: 'candidate-history', rank: 0 }),
  node('conclusion-1-candidate-opposition', 'Conclusion 1 candidate opposition', ['reasoning-1'], { topicId: 'conclusion-topic', proposal: 'opposition', targetId: 'conclusion-1', role: 'candidate-opposition', rank: 0 }),
];

const reasoning = buildKnowledgeRelations('reasoning-1', nodes);
assert.deepEqual(reasoning.previous.map(item => item.id), ['premise-a', 'premise-b'], 'a reasoning-process ball sees its real premise balls on the left');
assert.deepEqual(reasoning.next.map(item => item.id), ['conclusion-1'], 'a reasoning-process ball sees its real conclusion ball on the right');

const conclusion = buildKnowledgeRelations('conclusion-1', nodes);
assert.deepEqual(conclusion.previous.map(item => item.id), ['reasoning-1'], 'a conclusion sees the white reasoning-process ball itself on the left');
assert.deepEqual(conclusion.next.map(item => item.id), ['reasoning-2'], 'a conclusion reused later sees the next white reasoning-process ball on the right');
assert.deepEqual(
  conclusion.history.map(item => item.id),
  ['conclusion-1-old', 'conclusion-1-candidate-history'],
  'detail history contains only gray balls with a direct live line to the current ball',
);
assert.deepEqual(
  conclusion.opposition.map(item => item.id),
  ['conclusion-1-opposition', 'conclusion-1-candidate-opposition'],
  'detail opposition contains only red balls with a direct live line to the current ball',
);

const firstHistory = buildKnowledgeRelations('conclusion-1-old', nodes);
assert.deepEqual(
  firstHistory.history.map(item => item.id),
  ['conclusion-1', 'conclusion-1-older'],
  'opening history rank 1 exposes the two balls directly joined to it in the history chain',
);
assert.deepEqual(
  buildKnowledgeRelations('conclusion-1-older', nodes).history.map(item => item.id),
  ['conclusion-1-old'],
  'opening the oldest gray ball does not jump across rank 1 to the current ball',
);
assert.deepEqual(
  buildKnowledgeRelations('conclusion-1-candidate-history', nodes).history.map(item => item.id),
  ['conclusion-1'],
  'a pending gray candidate exposes only the target ball it is directly connected to',
);

const firstOpposition = buildKnowledgeRelations('conclusion-1-opposition', nodes);
assert.deepEqual(
  firstOpposition.opposition.map(item => item.id),
  ['conclusion-1', 'conclusion-1-opposition-older'],
  'opening opposition rank 1 exposes the two balls directly joined to it in the opposition chain',
);
assert.deepEqual(
  buildKnowledgeRelations('conclusion-1-opposition-older', nodes).opposition.map(item => item.id),
  ['conclusion-1-opposition'],
  'opening the oldest red ball does not jump across rank 1 to the current ball',
);
assert.deepEqual(
  buildKnowledgeRelations('conclusion-1-candidate-opposition', nodes).opposition.map(item => item.id),
  ['conclusion-1'],
  'a pending red candidate exposes only the target ball it is directly connected to',
);

const secondReasoning = buildKnowledgeRelations('reasoning-2', nodes);
assert.deepEqual(secondReasoning.previous.map(item => item.id), ['conclusion-1']);
assert.deepEqual(secondReasoning.next.map(item => item.id), ['conclusion-2']);

const edges = collectKnowledgeChainEdges(nodes);
const logicalEdges = edges.slice(0, 5);
assert.deepEqual(logicalEdges, [
  { fromId: 'premise-a', toId: 'reasoning-1' },
  { fromId: 'premise-b', toId: 'reasoning-1' },
  { fromId: 'reasoning-1', toId: 'conclusion-1' },
  { fromId: 'conclusion-1', toId: 'reasoning-2' },
  { fromId: 'reasoning-2', toId: 'conclusion-2' },
], 'logical lines remain the real current-node reasoning chain');

for (const edge of logicalEdges) {
  const from = buildKnowledgeRelations(edge.fromId, nodes);
  const to = buildKnowledgeRelations(edge.toId, nodes);
  assert.ok(from.next.some(item => item.id === edge.toId), `logical scene edge ${edge.fromId}->${edge.toId} must exist as a right-side detail relation`);
  assert.ok(to.previous.some(item => item.id === edge.fromId), `logical scene edge ${edge.fromId}->${edge.toId} must exist as a left-side detail relation`);
}

assert.deepEqual(edges.slice(5), [
  { fromId: 'conclusion-1', toId: 'conclusion-1-old' },
  { fromId: 'conclusion-1-old', toId: 'conclusion-1-older' },
  { fromId: 'conclusion-1', toId: 'conclusion-1-opposition' },
  { fromId: 'conclusion-1-opposition', toId: 'conclusion-1-opposition-older' },
  { fromId: 'conclusion-1', toId: 'conclusion-1-candidate-history' },
  { fromId: 'conclusion-1', toId: 'conclusion-1-candidate-opposition' },
], 'history/opposition are live rank-ordered chains and pending candidates connect to their target');

// Strong invariant for the local navigator: a detail button exists iff its
// target is one endpoint away on the exact canonical scene-line projection.
const undirectedEdgeKeys = new Set(edges.flatMap(edge => [
  `${edge.fromId}\0${edge.toId}`,
  `${edge.toId}\0${edge.fromId}`,
]));
for (const opened of nodes) {
  const relationIds = allRelatedIds(buildKnowledgeRelations(opened.id, nodes));
  assert.equal(new Set(relationIds).size, relationIds.length, `detail ${opened.id} must not duplicate one real neighbour across axes`);
  for (const relatedId of relationIds) {
    assert.ok(
      undirectedEdgeKeys.has(`${opened.id}\0${relatedId}`),
      `detail button ${opened.id} -> ${relatedId} must have a direct scene line`,
    );
  }
  for (const edge of edges.filter(edge => edge.fromId === opened.id || edge.toId === opened.id)) {
    const otherId = edge.fromId === opened.id ? edge.toId : edge.fromId;
    assert.ok(relationIds.includes(otherId), `direct scene-line endpoint ${otherId} must appear as a button when ${opened.id} is open`);
  }
}

assert.deepEqual(buildKnowledgeRelations('missing', nodes), {
  previous: [], next: [], history: [], opposition: [],
});

console.log('Canonical one-hop knowledge navigator and scene-edge tests passed');
