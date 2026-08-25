import { strict as assert } from 'node:assert';
import type { KnowledgeRelationNode } from './KnowledgeRelations';
import { createKnowledgeRelationIndex } from './KnowledgeRelations';

const nodes: KnowledgeRelationNode[] = [
  { id: 'p', title: 'Premise', premises: [] },
  { id: 'r', title: 'Reasoning', premises: ['p'], type: 'reasoning' },
  { id: 'c', title: 'Conclusion', premises: ['r'] },
  {
    id: 'c-old', title: 'Old conclusion', premises: ['r'],
    lineage: { topicId: 'c', proposal: 'optimization', targetId: 'c', role: 'history', rank: 1 },
  },
];

const index = createKnowledgeRelationIndex(nodes);
const stableEdges = index.edges;
assert.deepEqual(stableEdges, [
  { fromId: 'p', toId: 'r' },
  { fromId: 'r', toId: 'c' },
  { fromId: 'c', toId: 'c-old' },
]);
assert.strictEqual(index.edges, stableEdges, 'one relation index must retain one stable edge projection across repeated reads');

for (let i = 0; i < 1000; i += 1) {
  assert.deepEqual(index.relationsFor('r').previous.map(item => item.id), ['p']);
  assert.deepEqual(index.relationsFor('r').next.map(item => item.id), ['c']);
  assert.deepEqual(index.relationsFor('c').history.map(item => item.id), ['c-old']);
}

assert.deepEqual(index.relationsFor('missing'), { previous: [], next: [], history: [], opposition: [] });
console.log('Knowledge relation generation index regression tests passed');
