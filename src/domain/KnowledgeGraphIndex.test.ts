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
assert.equal(index.dominantByTopic.get('topic'), current, 'ordinary topics use Current as logical authority');
assert.deepEqual(
  effectivePremiseIds(consumer, index),
  ['current', 'missing'],
  'ordinary premise substitution and stable de-duplication remain identical',
);

const whiteReasoning: GraphNode = {
  id: 'reasoning-white',
  title: 'white',
  type: 'reasoning',
  status: 'verified',
  premises: ['premise-a'],
  mastery: 'none',
  reasoning: 'white reasoning',
  lineage: {
    topicId: 'reasoning-topic',
    proposal: 'new',
    role: 'current',
    rank: 0,
    reasoningSide: 'normal',
    reasoningSideRank: 0,
    reasoningDominant: false,
  },
};
const redReasoning: GraphNode = {
  id: 'reasoning-red',
  title: 'red',
  type: 'reasoning',
  status: 'verified',
  premises: ['premise-a'],
  mastery: 'none',
  reasoning: 'red reasoning',
  lineage: {
    topicId: 'reasoning-topic',
    proposal: 'opposition',
    targetId: 'reasoning-white',
    role: 'current',
    rank: 0,
    reasoningSide: 'opposition',
    reasoningSideRank: 0,
    reasoningDominant: true,
  },
};
const reasoningConsumer = node('reasoning-consumer', ['reasoning-white']);
const reasoningIndex = createKnowledgeGraphIndex([whiteReasoning, redReasoning, reasoningConsumer]);

assert.equal(
  reasoningIndex.currentByTopic.get('reasoning-topic'),
  whiteReasoning,
  'the white Current head remains the canonical Current identity even when red wins',
);
assert.equal(
  reasoningIndex.dominantByTopic.get('reasoning-topic'),
  redReasoning,
  'logical authority follows the winning reasoning-side head independently from colour/current identity',
);
assert.deepEqual(
  effectivePremiseIds(reasoningConsumer, reasoningIndex),
  ['reasoning-red'],
  'rendered premise topology must follow the dominant reasoning head used by canonical detail relations',
);

console.log('Knowledge graph generation index regression tests passed');
