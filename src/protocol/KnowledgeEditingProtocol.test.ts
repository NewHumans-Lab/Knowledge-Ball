import { strict as assert } from 'node:assert';
import {
  applyKnowledgeEdit,
  validateKnowledgeEdit,
  validateReasoningChain,
  type KnowledgeEdit,
  type ProtocolNode,
  type ReasoningChain,
} from './KnowledgeEditingProtocol';

const node = (
  id: string,
  type: ProtocolNode['type'],
  premises: string[] = [],
  reasoning = `${id} description`,
  extras: Partial<ProtocolNode> = {},
): ProtocolNode => ({
  id,
  title: id,
  type,
  premises,
  reasoning,
  status: 'verified',
  hidden: false,
  ...extras,
});

const base: ProtocolNode[] = [
  node('logic-mp', 'logic-symbol', [], 'Modus ponens classification'),
  node('p1', 'fact'),
  node('p2', 'axiom'),
  node('r1', 'reasoning', ['p1', 'p2'], 'P1 and P2 imply C', { logicRuleId: 'logic-mp' }),
  node('c1', 'theorem', ['r1']),
];
const chain: ReasoningChain = { premiseIds: ['p1', 'p2'], reasoningId: 'r1', conclusionId: 'c1' };

assert.deepEqual(validateReasoningChain(base, chain), []);
assert.match(validateReasoningChain(base, { ...chain, premiseIds: ['p1'] })[0], /不一致/);

function apply(nodes: ProtocolNode[], edit: KnowledgeEdit): ProtocolNode[] {
  const result = applyKnowledgeEdit(nodes, edit);
  assert.deepEqual(result.errors, []);
  return result.nodes;
}

// Atomic knowledge can be added without a fake inference, while derived knowledge cannot.
const atomic = apply(base, {
  kind: 'add',
  mode: 'atomic',
  node: { id: 'definition-new', title: 'Unique definition', type: 'definition', reasoning: 'A unique definition description' },
});
assert.equal(atomic.find(item => item.id === 'definition-new')?.premises.length, 0);

const incompleteTheory = validateKnowledgeEdit(base, {
  kind: 'add',
  mode: 'theory',
  requiredPremiseIds: [],
  reasoning: { id: 'r-invalid', title: 'Invalid inference', type: 'reasoning', reasoning: 'Invalid inference text' },
  conclusion: { id: 'c-invalid', title: 'Invalid result', type: 'theorem', reasoning: 'Invalid result text' },
});
assert(incompleteTheory.some(error => error.includes('至少一个已有知识前提')));
assert(!incompleteTheory.some(error => error.includes('逻辑符号')), 'logic-symbol classification is optional');

const added = apply(base, {
  kind: 'add',
  mode: 'theory',
  requiredPremiseIds: ['p1'],
  reasoning: {
    id: 'r-new',
    title: 'New inference process',
    type: 'reasoning',
    reasoning: 'A separately classified inference',
    logicRuleId: 'logic-mp',
  },
  conclusion: { id: 'c-new', title: 'New conclusion', type: 'hypothesis', reasoning: 'A new result description' },
});
assert.deepEqual(added.find(item => item.id === 'r-new')?.premises, ['p1']);
assert.deepEqual(added.find(item => item.id === 'c-new')?.premises, ['r-new']);

// Every negation is evidence-bearing and the command is atomic on validation failure.
const missingCounterexample = validateKnowledgeEdit(base, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'c1',
  counterexampleIds: [],
});
assert(missingCounterexample.some(error => error.includes('反例')));
const invalidSnapshot = structuredClone(base);
const invalidResult = applyKnowledgeEdit(invalidSnapshot, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'c1',
  counterexampleIds: [],
});
assert.strictEqual(invalidResult.nodes, invalidSnapshot);
assert.equal(invalidResult.nodes.find(item => item.id === 'c1')?.status, 'verified');

const opposition = [
  ...base,
  node('counter', 'fact', [], 'Observed counterexample'),
  node('counter-counter', 'fact', [], 'Evidence rejecting the counterexample'),
  node('downstream', 'prediction', ['c1'], 'A downstream result'),
];
const negated = apply(opposition, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'c1',
  counterexampleIds: ['counter'],
});
assert.equal(negated.find(item => item.id === 'c1')?.status, 'falsified');
assert.equal(negated.find(item => item.id === 'c1')?.hidden, true);
assert.equal(negated.find(item => item.id === 'downstream')?.status, 'suspended');

// A falsified claim is liberated only after its recorded opposition is itself negated.
const restored = apply(negated, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'counter',
  counterexampleIds: ['counter-counter'],
});
assert.equal(restored.find(item => item.id === 'c1')?.status, 'pending');
assert.equal(restored.find(item => item.id === 'c1')?.hidden, false);

const negatedLogicRule = apply(opposition, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'logic-mp',
  counterexampleIds: ['counter'],
});
assert.equal(negatedLogicRule.find(item => item.id === 'r1')?.status, 'suspended');
assert.equal(negatedLogicRule.find(item => item.id === 'c1')?.status, 'suspended');

const missingCorrection = validateKnowledgeEdit([...base, node('counter', 'fact')], {
  kind: 'negate',
  target: 'reasoning',
  targetId: 'r1',
  counterexampleIds: ['counter'],
});
assert(missingCorrection.some(error => error.includes('正确推理过程')));

const corrected = apply(opposition, {
  kind: 'negate',
  target: 'reasoning',
  targetId: 'r1',
  counterexampleIds: ['counter'],
  correctedReasoning: {
    id: 'r-correct',
    title: 'Corrected reasoning',
    type: 'reasoning',
    reasoning: 'A corrected and classified inference',
    logicRuleId: 'logic-mp',
  },
});
assert.deepEqual(corrected.find(item => item.id === 'r-correct')?.premises, ['p1', 'p2']);
assert.deepEqual(corrected.find(item => item.id === 'c1')?.premises, ['r-correct']);
assert.equal(corrected.find(item => item.id === 'r1')?.hidden, true);

const restoredReasoning = apply(corrected, {
  kind: 'negate',
  target: 'conclusion',
  targetId: 'counter',
  counterexampleIds: ['counter-counter'],
});
assert.equal(restoredReasoning.find(item => item.id === 'r1')?.hidden, false);
assert.equal(restoredReasoning.find(item => item.id === 'r1')?.status, 'pending');
assert.equal(restoredReasoning.find(item => item.id === 'r-correct')?.hidden, true);
assert.deepEqual(restoredReasoning.find(item => item.id === 'c1')?.premises, ['r1']);

// Historical hidden nodes reserve titles; duplicate descriptions are advisory only.
const hiddenHistory = [
  ...base,
  node('def-en', 'definition', [], 'A prime has exactly two positive divisors', { hidden: true, status: 'suspended', supersededBy: 'def-current' }),
  node('def-current', 'definition', [], 'Current canonical prime definition'),
];
const duplicateHidden = validateKnowledgeEdit(hiddenHistory, {
  kind: 'add',
  mode: 'atomic',
  node: { id: 'duplicate-hidden', title: 'def-en', type: 'definition', reasoning: 'A fresh description' },
});
assert(duplicateHidden.some(error => error.includes('标题')));
const duplicateHiddenDescription = validateKnowledgeEdit(hiddenHistory, {
  kind: 'add',
  mode: 'atomic',
  node: { id: 'duplicate-hidden-description', title: 'Fresh title', type: 'fact', reasoning: 'A prime has exactly two positive divisors' },
});
assert.deepEqual(duplicateHiddenDescription, []);

console.log('Knowledge editing protocol regression tests passed');

// Reasoning processes and logic classifiers are not ordinary knowledge premises.
const invalidPremises = validateKnowledgeEdit(base, {
  kind: 'add', mode: 'theory', requiredPremiseIds: ['r1', 'logic-mp'],
  reasoning: { id: 'bad-r', title: 'Bad reasoning', type: 'reasoning', reasoning: 'Bad inference text', logicRuleId: 'logic-mp' },
  conclusion: { id: 'bad-c', title: 'Bad conclusion', type: 'theorem', reasoning: 'Bad conclusion text' },
});
assert(invalidPremises.some(error => error.includes('普通知识结论')));
