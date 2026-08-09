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
assert(incompleteTheory.some(error => error.includes('逻辑符号')));

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

// Decomposition is committed only when every P -> R -> M -> R -> C link exists.
const incompleteDecomposition = validateKnowledgeEdit(base, {
  kind: 'decompose',
  chain,
  reasoningSteps: [
    { id: 'r-step-x1', title: 'Step X1', type: 'reasoning', reasoning: 'Step X inference one', logicRuleId: 'logic-mp' },
    { id: 'r-step-x2', title: 'Step X2', type: 'reasoning', reasoning: 'Step X inference two', logicRuleId: 'logic-mp' },
  ],
  intermediateConclusions: [],
});
assert(incompleteDecomposition.some(error => error.includes('中间知识结论')));

const decomposed = apply(base, {
  kind: 'decompose',
  chain,
  reasoningSteps: [
    { id: 'r-step-1', title: 'Step one', type: 'reasoning', reasoning: 'First smaller inference', logicRuleId: 'logic-mp' },
    { id: 'r-step-2', title: 'Step two', type: 'reasoning', reasoning: 'Second smaller inference', logicRuleId: 'logic-mp' },
  ],
  intermediateConclusions: [
    { id: 'middle', title: 'Intermediate conclusion', type: 'theorem', reasoning: 'Result after the first inference' },
  ],
});
assert.deepEqual(decomposed.find(item => item.id === 'r-step-1')?.premises, ['p1', 'p2']);
assert.deepEqual(decomposed.find(item => item.id === 'middle')?.premises, ['r-step-1']);
assert.deepEqual(decomposed.find(item => item.id === 'r-step-2')?.premises, ['middle']);
assert.deepEqual(decomposed.find(item => item.id === 'c1')?.premises, ['r-step-2']);
assert.equal(decomposed.find(item => item.id === 'r1')?.hidden, true);

// Definitions merge from distinct descriptions of the same declared semantic identity.
const definitions = [
  ...base,
  node('def-en', 'definition', [], 'A prime has exactly two positive divisors'),
  node('def-zh', 'definition', [], '质数只有两个正因数'),
];
const mergedDefinitions = apply(definitions, {
  kind: 'merge',
  mode: 'definition',
  sourceNodeIds: ['def-en', 'def-zh'],
  semanticKey: 'definition:prime-number',
  mergedDefinition: {
    id: 'def-prime',
    title: 'Prime number — canonical definition',
    type: 'definition',
    reasoning: 'Canonical multilingual definition of a prime number',
  },
});
assert.deepEqual(mergedDefinitions.find(item => item.id === 'def-prime')?.aliases?.sort(), ['def-en', 'def-zh']);
assert.equal(mergedDefinitions.find(item => item.id === 'def-en')?.hidden, true);
assert.equal(mergedDefinitions.find(item => item.id === 'def-zh')?.hidden, true);

// Theory merge first proves inference equivalence, then creates its unified conclusion.
const theoryNodes = [
  ...base,
  node('r2', 'reasoning', ['p1', 'p2'], 'The same implication expressed in alternative wording', { logicRuleId: 'logic-mp' }),
  node('c2', 'theorem', ['r2'], 'Alternative conclusion wording'),
];
const mergedTheory = apply(theoryNodes, {
  kind: 'merge',
  mode: 'theory',
  chains: [
    chain,
    { premiseIds: ['p2', 'p1'], reasoningId: 'r2', conclusionId: 'c2' },
  ],
  reasoningSemanticKey: 'inference:shared-p1-p2',
  semanticKey: 'theorem:shared-result',
  mergedReasoning: {
    id: 'r-merged',
    title: 'Unified inference',
    type: 'reasoning',
    reasoning: 'Canonical synthesis of the shared inference',
    logicRuleId: 'logic-mp',
  },
  mergedConclusion: {
    id: 'c-merged',
    title: 'Unified conclusion',
    type: 'theorem',
    reasoning: 'Canonical description of the shared result',
  },
});
assert.deepEqual(mergedTheory.find(item => item.id === 'c-merged')?.aliases?.sort(), ['c1', 'c2']);
assert.deepEqual(mergedTheory.find(item => item.id === 'c-merged')?.premises, ['r-merged']);
assert.equal(mergedTheory.find(item => item.id === 'r1')?.hidden, true);
assert.equal(mergedTheory.find(item => item.id === 'c2')?.hidden, true);

// Historical hidden nodes still reserve both their title and their description.
const duplicateHidden = validateKnowledgeEdit(mergedDefinitions, {
  kind: 'add',
  mode: 'atomic',
  node: { id: 'duplicate-hidden', title: 'def-en', type: 'definition', reasoning: 'A fresh description' },
});
assert(duplicateHidden.some(error => error.includes('标题')));
const duplicateHiddenDescription = validateKnowledgeEdit(mergedDefinitions, {
  kind: 'add',
  mode: 'atomic',
  node: { id: 'duplicate-hidden-description', title: 'Fresh title', type: 'fact', reasoning: '质数只有两个正因数' },
});
assert(duplicateHiddenDescription.some(error => error.includes('描述')));

console.log('Knowledge editing protocol regression tests passed');

// Reasoning processes and logic classifiers are not ordinary knowledge premises.
const invalidPremises = validateKnowledgeEdit(base, {
  kind: 'add', mode: 'theory', requiredPremiseIds: ['r1', 'logic-mp'],
  reasoning: { id: 'bad-r', title: 'Bad reasoning', type: 'reasoning', reasoning: 'Bad inference text', logicRuleId: 'logic-mp' },
  conclusion: { id: 'bad-c', title: 'Bad conclusion', type: 'theorem', reasoning: 'Bad conclusion text' },
});
assert(invalidPremises.some(error => error.includes('普通知识结论')));

// A unified conclusion replaces source conclusions in every active downstream chain.
const downstreamNodes = [
  ...theoryNodes,
  node('r-downstream', 'reasoning', ['c1'], 'Downstream inference', { logicRuleId: 'logic-mp' }),
  node('c-downstream', 'theorem', ['r-downstream'], 'Downstream conclusion'),
];
const downstreamMerged = apply(downstreamNodes, {
  kind: 'merge', mode: 'theory', chains: [chain, { premiseIds: ['p2', 'p1'], reasoningId: 'r2', conclusionId: 'c2' }],
  reasoningSemanticKey: 'inference:downstream', semanticKey: 'theorem:downstream',
  mergedReasoning: { id: 'r-unified', title: 'Unified inference downstream', type: 'reasoning', reasoning: 'Canonical downstream source inference', logicRuleId: 'logic-mp' },
  mergedConclusion: { id: 'c-unified', title: 'Unified conclusion downstream', type: 'theorem', reasoning: 'Canonical downstream result' },
});
assert.deepEqual(downstreamMerged.find(item => item.id === 'r-downstream')?.premises, ['c-unified']);
