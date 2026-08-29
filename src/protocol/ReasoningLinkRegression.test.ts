import { strict as assert } from 'node:assert';
import { findExistingReasoningForLink } from '../command/KnowledgeEdit';
import type { GraphState } from '../state/GraphState';
import {
  applyKnowledgeEdit,
  validateKnowledgeEdit,
  type AddReasoningLinkEdit,
  type ProtocolNode,
} from './KnowledgeEditingProtocol';

const node = (
  id: string,
  type: ProtocolNode['type'],
  premises: string[] = [],
  extras: Partial<ProtocolNode> = {},
): ProtocolNode => ({
  id,
  title: id,
  type,
  premises,
  reasoning: `${id} content`,
  status: 'verified',
  hidden: false,
  ...extras,
});

const current = (id: string): NonNullable<ProtocolNode['lineage']> => ({
  topicId: id,
  proposal: 'new',
  role: 'current',
  rank: 0,
});

const base: ProtocolNode[] = [
  node('p-current', 'fact', [], { lineage: current('p-current') }),
  node('p-pending', 'fact', [], { status: 'pending', lineage: current('p-pending') }),
  node('p-history', 'fact', [], { lineage: { topicId: 'topic-h', proposal: 'new', role: 'history', rank: 1 } }),
  node('p-opposition', 'fact', [], { lineage: { topicId: 'topic-o', proposal: 'opposition', role: 'opposition', rank: 1 } }),
  node('p-reasoning', 'reasoning', ['p-current'], { lineage: current('p-reasoning') }),
  node('p-logic', 'logic-symbol', [], { lineage: current('p-logic') }),
  node('conclusion', 'theorem', []),
  node('conclusion-2', 'theorem', []),
  node('conclusion-pending', 'hypothesis', [], { status: 'pending' }),
  node('conclusion-history', 'fact', [], { lineage: { topicId: 'topic-c', proposal: 'new', role: 'history', rank: 1 } }),
  node('conclusion-reasoning', 'reasoning', ['p-current']),
];

function edit(overrides: Partial<AddReasoningLinkEdit> = {}): AddReasoningLinkEdit {
  return {
    kind: 'add',
    mode: 'reasoning-link',
    requiredPremiseIds: ['p-current'],
    reasoning: {
      id: 'r-new',
      title: 'Explicit reasoning',
      type: 'reasoning',
      reasoning: 'Premise therefore conclusion.',
    },
    conclusionIds: ['conclusion'],
    ...overrides,
  };
}

assert.deepEqual(validateKnowledgeEdit(base, edit()), []);
assert(validateKnowledgeEdit(base, edit({ conclusionIds: [] })).some(error => error.includes('必须且只能选择一个')));
assert(validateKnowledgeEdit(base, edit({ conclusionIds: ['conclusion', 'conclusion-2'] })).some(error => error.includes('必须且只能选择一个')), 'one Reasoning may never serve two concrete conclusions');

const result = applyKnowledgeEdit(base, edit());
assert.deepEqual(result.errors, []);
assert.equal(result.nodes.filter(item => item.id === 'r-new').length, 1, 'reasoning-link creates exactly one node');
assert.deepEqual(result.nodes.find(item => item.id === 'r-new')?.premises, ['p-current']);
assert.deepEqual(result.nodes.find(item => item.id === 'conclusion')?.premises, ['r-new']);
assert.equal(result.nodes.find(item => item.id === 'conclusion-2')?.premises.length, 0, 'a Reasoning attaches only to its one concrete conclusion');
assert.equal(result.nodes.find(item => item.id === 'conclusion')?.title, 'conclusion', 'existing conclusion identity/content is preserved');

const preservesExistingParents = applyKnowledgeEdit(
  base.map(item => item.id === 'conclusion' ? { ...item, premises: ['p-logic'] } : item),
  edit(),
);
assert.deepEqual(preservesExistingParents.errors, []);
assert.deepEqual(preservesExistingParents.nodes.find(item => item.id === 'conclusion')?.premises.sort(), ['p-logic', 'r-new']);

assert(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['p-pending'] })).some(error => error.includes('已通过验证')));
assert(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['p-history'] })).some(error => error.includes('当前')));
assert(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['p-opposition'] })).some(error => error.includes('当前')));
assert(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['p-reasoning'] })).some(error => error.includes('非推理')));
assert.deepEqual(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['p-logic'] })), [], 'logic-symbol is not excluded by the product premise rule');

assert.deepEqual(validateKnowledgeEdit(base, edit({ conclusionIds: ['conclusion-pending'] })), [], 'pending non-reasoning conclusions remain selectable');
assert.deepEqual(validateKnowledgeEdit(base, edit({ conclusionIds: ['conclusion-history'] })), [], 'historical non-reasoning conclusions remain selectable');
assert(validateKnowledgeEdit(base, edit({ conclusionIds: ['conclusion-reasoning'] })).some(error => error.includes('结论不能是推理节点')));
assert(validateKnowledgeEdit(base, edit({ conclusionIds: ['missing'] })).some(error => error.includes('结论不存在')));
assert(validateKnowledgeEdit(base, edit({ requiredPremiseIds: ['missing'] })).some(error => error.includes('前提不存在')));
assert(validateKnowledgeEdit(base, edit({ conclusionIds: ['p-current'] })).some(error => error.includes('同时作为前提和结论')));

const cyclic = [
  node('a', 'fact'),
  node('b', 'theorem', ['a']),
];
assert(validateKnowledgeEdit(cyclic, edit({ requiredPremiseIds: ['b'], conclusionIds: ['a'] })).some(error => error.includes('依赖环')));

// Premise identity remains topic-normalized, but conclusion identity is the exact
// immutable ball. Optimizing a conclusion therefore does not silently retarget an
// existing Reasoning to the newer ball.
const identityNodes: ProtocolNode[] = [
  node('identity-premise', 'fact', [], { lineage: { ...current('identity-premise'), topicId: 'premise-topic' } }),
  node('identity-conclusion-old', 'theorem', ['identity-reasoning'], {
    hidden: true,
    lineage: { topicId: 'conclusion-topic', proposal: 'new', role: 'history', rank: 1 },
  }),
  node('identity-conclusion-current', 'theorem', ['identity-reasoning'], {
    lineage: { topicId: 'conclusion-topic', proposal: 'optimization', targetId: 'identity-conclusion-old', role: 'current', rank: 0 },
  }),
  node('identity-reasoning', 'reasoning', ['identity-premise'], {
    title: 'Existing endpoint reasoning',
    reasoning: 'Completely different prose does not change identity.',
    lineage: { ...current('identity-reasoning'), topicId: 'reasoning-topic' },
  }),
];
const identityState: GraphState = {
  nodesById: Object.fromEntries(identityNodes.map(item => [item.id, { ...item, mastery: 'none' as const }])),
};
assert.equal(
  findExistingReasoningForLink(identityState, ['identity-premise'], ['identity-conclusion-old'])?.id,
  'identity-reasoning',
  'same premise topics and same concrete conclusion must resolve to the existing Reasoning',
);
assert.equal(
  findExistingReasoningForLink(identityState, ['identity-premise'], ['identity-conclusion-current']),
  null,
  'a newer immutable conclusion ball is a different Reasoning endpoint even when its topic is the same',
);
assert.equal(
  findExistingReasoningForLink(identityState, ['identity-premise'], ['conclusion']),
  null,
  'a different concrete conclusion remains a different Reasoning identity',
);

console.log('Single-concrete-conclusion reasoning-link protocol regression tests passed');
