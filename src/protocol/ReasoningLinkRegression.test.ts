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

const current = (id: string): ProtocolNode['lineage'] => ({
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

const result = applyKnowledgeEdit(base, edit());
assert.deepEqual(result.errors, []);
assert.equal(result.nodes.filter(item => item.id === 'r-new').length, 1, 'reasoning-link creates exactly one node');
assert.deepEqual(result.nodes.find(item => item.id === 'r-new')?.premises, ['p-current']);
assert.deepEqual(result.nodes.find(item => item.id === 'conclusion')?.premises, ['r-new']);
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

const identityNodes: ProtocolNode[] = [
  node('identity-premise', 'fact', [], { lineage: { ...current('identity-premise'), topicId: 'premise-topic' } }),
  node('identity-conclusion-old', 'theorem', ['identity-reasoning'], {
    hidden: true,
    lineage: { topicId: 'conclusion-topic', proposal: 'new', role: 'history', rank: 1 },
  }),
  node('identity-conclusion-current', 'theorem', ['identity-reasoning'], {
    lineage: { ...current('identity-conclusion-current'), topicId: 'conclusion-topic' },
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
const duplicate = findExistingReasoningForLink(
  identityState,
  ['identity-premise'],
  ['identity-conclusion-current'],
);
assert.equal(duplicate?.id, 'identity-reasoning', 'same premise/conclusion topics must resolve to the existing reasoning regardless of prose');
assert.equal(
  findExistingReasoningForLink(identityState, ['identity-premise'], ['conclusion']),
  null,
  'different conclusions remain a different reasoning identity',
);

console.log('Explicit reasoning-link protocol regression tests passed');
