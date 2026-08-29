import assert from 'node:assert/strict';
import type { GraphNode } from '../graph/Node';
import { createKnowledgeGraphIndex, effectivePremiseIds } from './KnowledgeGraphIndex';

const node = (id: string, premises: string[] = [], topicId = id, rank = 0): GraphNode => ({
  id,
  title: id,
  type: 'fact',
  status: 'verified',
  premises,
  mastery: 'none',
  reasoning: id,
  lineage: { topicId, proposal: rank === 0 ? 'new' : 'optimization', rank, role: rank === 0 ? 'current' : 'history' },
});

const old = node('old', [], 'topic', 1);
const current = node('current', [], 'topic', 0);
const consumer = node('consumer', ['old', 'current', 'missing']);
const index = createKnowledgeGraphIndex([old, current, consumer]);

assert.equal(index.byId.get('old'), old, 'the generation index preserves node identity');
assert.equal(index.currentByTopic.get('topic'), current, 'the canonical Current member is indexed once per topic');
assert.deepEqual(
  effectivePremiseIds(consumer, index),
  ['current', 'missing'],
  'premise substitution and stable de-duplication remain identical',
);

console.log('Knowledge graph generation index regression tests passed');
