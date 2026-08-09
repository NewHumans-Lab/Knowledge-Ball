import assert from 'node:assert/strict';
import {
  applyKnowledgeEdit,
  validateKnowledgeEdit,
  validateReasoningChain,
  type ProtocolNode,
} from './KnowledgeEditingProtocol';

const node = (
  id: string,
  type: ProtocolNode['type'],
  premises: string[] = [],
  extra: Partial<ProtocolNode> = {},
): ProtocolNode => ({
  id,
  title: `Title ${id}`,
  type,
  reasoning: `Description ${id}`,
  premises,
  status: 'pending',
  hidden: false,
  ...extra,
});

const base = [
  node('p', 'fact'),
  node('logic', 'logic-symbol'),
  node('r', 'reasoning', ['p'], { logicRuleId: 'logic' }),
  node('c', 'theorem', ['r']),
];

for (const invalidPremiseId of ['r', 'logic']) {
  const errors = validateKnowledgeEdit(base, {
    kind: 'add',
    mode: 'theory',
    requiredPremiseIds: [invalidPremiseId],
    reasoning: node('new-r', 'reasoning', [], { logicRuleId: 'logic' }),
    conclusion: node('new-c', 'theorem'),
  });
  assert.ok(errors.length > 0, `${invalidPremiseId} must not be accepted as an ordinary premise`);
}

assert.ok(
  validateReasoningChain(
    [...base.slice(0, 3), node('bad-c', 'theorem', ['r', 'p'])],
    { premiseIds: ['p'], reasoningId: 'r', conclusionId: 'bad-c' },
  ).length > 0,
  'a theory conclusion must depend on exactly one reasoning node',
);

assert.ok(
  validateKnowledgeEdit(base, {
    kind: 'negate',
    target: 'conclusion',
    targetId: 'c',
    counterexampleIds: ['logic'],
  }).length > 0,
  'logic-symbol nodes must not be accepted as counterexamples',
);

const definitions = [
  node('d1', 'definition'),
  node('d2', 'definition'),
  node('dependent', 'fact', ['d1']),
];
const definitionMerge = applyKnowledgeEdit(definitions, {
  kind: 'merge',
  mode: 'definition',
  sourceNodeIds: ['d1', 'd2'],
  semanticKey: 'definition:key',
  mergedDefinition: node('d3', 'definition'),
});
assert.deepEqual(definitionMerge.errors, []);
assert.deepEqual(
  definitionMerge.nodes.find(candidate => candidate.id === 'dependent')?.premises,
  ['d3'],
  'active dependants must be redirected away from hidden merged definitions',
);

console.log('Protocol adversarial regression tests passed');
