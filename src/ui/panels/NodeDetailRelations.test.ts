import assert from 'node:assert/strict';
import type { GraphNode } from '../../graph/Node';
import { buildNodeDetailRelations } from './NodeDetailRelations';

function graphNode(
  id: string,
  title: string,
  topicId: string,
  role: 'current' | 'history' | 'opposition',
  rank: number,
  premises: string[] = [],
): GraphNode {
  return {
    id,
    title,
    type: 'theorem',
    status: 'verified',
    mastery: 'none',
    reasoning: `${title} content`,
    premises,
    hidden: role !== 'current',
    lineage: { topicId, proposal:'new', role, rank },
  };
}

const nodes: GraphNode[] = [
  graphNode('A2', 'A current', 'A', 'current', 0),
  graphNode('A1', 'A previous', 'A', 'history', 1),
  graphNode('A0', 'A oldest', 'A', 'history', 2),
  graphNode('AX1', 'A opposing latest', 'A', 'opposition', 1),
  graphNode('AX0', 'A opposing older', 'A', 'opposition', 2),
  // B's immutable payload still names A1. UI must resolve that premise topic to
  // A2 without rewriting B, matching module-6 effective dependency semantics.
  graphNode('B', 'B', 'B', 'current', 0, ['A1']),
  graphNode('C', 'C', 'C', 'current', 0, ['B']),
  graphNode('D', 'D', 'D', 'current', 0, ['C']),
];

const a = buildNodeDetailRelations('A2', nodes);
assert.deepEqual(a.premises, []);
assert.deepEqual(a.conclusions.map(item => item.id), ['B'], 'right side is distance=1 only');
assert.deepEqual(a.history.map(item => item.id), ['A1','A0'], 'nearest gray history comes first');
assert.deepEqual(a.opposition.map(item => item.id), ['AX1','AX0'], 'nearest red opposition comes first');

const b = buildNodeDetailRelations('B', nodes);
assert.deepEqual(b.premises.map(item => item.id), ['A2'], 'left relation resolves the premise topic current version');
assert.deepEqual(b.conclusions.map(item => item.id), ['C']);
assert.equal(b.conclusions.some(item => item.id === 'D'), false, 'transitive conclusions must not leak into detail view');
assert.deepEqual(b.history, []);
assert.deepEqual(b.opposition, []);

const oldA = buildNodeDetailRelations('A1', nodes);
assert.deepEqual(oldA.history.map(item => item.id), ['A0'], 'opened old ball is excluded from its own top chain');
assert.deepEqual(oldA.conclusions, [], 'dependents follow effective current A2 rather than old A1');

assert.deepEqual(buildNodeDetailRelations('missing', nodes), {
  premises: [], conclusions: [], history: [], opposition: [],
});

console.log('Node detail direct relation layout tests passed');
