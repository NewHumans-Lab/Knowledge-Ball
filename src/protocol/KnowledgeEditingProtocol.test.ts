import { strict as assert } from 'node:assert';
import {
  applyKnowledgeEdit,
  validateKnowledgeEdit,
  validateReasoningChain,
  type ProtocolNode,
  type ReasoningChain,
} from './KnowledgeEditingProtocol';

const node = (
  id: string,
  type: ProtocolNode['type'],
  premises: string[] = [],
  reasoning = `${id} description`,
): ProtocolNode => ({ id, title: id, type, premises, reasoning, status: 'verified' });

const base = [
  node('p1', 'fact'),
  node('p2', 'axiom'),
  node('r1', 'reasoning', ['p1', 'p2'], 'P1 and P2 imply C'),
  node('c1', 'theorem', ['r1']),
];
const chain: ReasoningChain = { premiseIds: ['p1', 'p2'], reasoningId: 'r1', conclusionId: 'c1' };

assert.deepEqual(validateReasoningChain(base, chain), []);
assert.match(validateReasoningChain(base, { ...chain, premiseIds: ['p1'] })[0], /不一致/);

const missingCounterexample = validateKnowledgeEdit(base, {
  kind: 'negate', target: 'conclusion', targetId: 'c1',
});
assert(missingCounterexample.some(error => error.includes('反例')));

const counterexampleResult = applyKnowledgeEdit([...base, node('counter', 'fact')], {
  kind: 'negate', target: 'conclusion', targetId: 'c1', counterexampleIds: ['counter'],
});
assert.equal(counterexampleResult.errors.length, 0);
assert.equal(counterexampleResult.nodes.find(item => item.id === 'c1')?.status, 'falsified');

const missingCorrection = validateKnowledgeEdit(base, {
  kind: 'negate', target: 'reasoning', targetId: 'r1',
});
assert(missingCorrection.some(error => error.includes('正确的推理过程')));

const corrected = applyKnowledgeEdit(base, {
  kind: 'negate',
  target: 'reasoning',
  targetId: 'r1',
  correctedReasoning: { id: 'r-correct', title: '正确推理', type: 'reasoning', reasoning: 'valid inference' },
});
assert.equal(corrected.errors.length, 0);
assert.deepEqual(corrected.nodes.find(item => item.id === 'r-correct')?.premises, ['p1', 'p2']);
assert.deepEqual(corrected.nodes.find(item => item.id === 'c1')?.premises, ['r-correct']);
assert.equal(corrected.nodes.find(item => item.id === 'r1')?.supersededBy, 'r-correct');

const decomposed = applyKnowledgeEdit(base, {
  kind: 'decompose',
  chain,
  reasoningSteps: [
    { id: 'r-step-1', title: '步骤一', type: 'reasoning', reasoning: 'first inference' },
    { id: 'r-step-2', title: '步骤二', type: 'reasoning', reasoning: 'second inference' },
  ],
  intermediateConclusions: [
    { id: 'middle', title: '中间结论', type: 'theorem', reasoning: 'result of first inference' },
  ],
});
assert.equal(decomposed.errors.length, 0);
assert.deepEqual(decomposed.nodes.find(item => item.id === 'r-step-1')?.premises, ['p1', 'p2']);
assert.deepEqual(decomposed.nodes.find(item => item.id === 'middle')?.premises, ['r-step-1']);
assert.deepEqual(decomposed.nodes.find(item => item.id === 'r-step-2')?.premises, ['middle']);
assert.deepEqual(decomposed.nodes.find(item => item.id === 'c1')?.premises, ['r-step-2']);

const secondChainNodes = [
  ...base,
  node('r2', 'reasoning', ['p2', 'p1'], ' p1  AND p2 imply c '),
  node('c2', 'theorem', ['r2']),
];
const merged = applyKnowledgeEdit(secondChainNodes, {
  kind: 'merge',
  chains: [chain, { premiseIds: ['p2', 'p1'], reasoningId: 'r2', conclusionId: 'c2' }],
  semanticKey: 'same-conclusion',
  mergedReasoning: { id: 'r-merged', title: '统一推理', type: 'reasoning', reasoning: 'P1 and P2 imply C' },
  mergedConclusion: { id: 'c-merged', title: '统一结论', type: 'theorem', reasoning: 'same semantic result' },
});
assert.equal(merged.errors.length, 0);
assert.deepEqual(merged.nodes.find(item => item.id === 'c-merged')?.aliases?.sort(), ['c1', 'c2']);
assert.deepEqual(merged.nodes.find(item => item.id === 'c-merged')?.premises, ['r-merged']);

const added = applyKnowledgeEdit(base, {
  kind: 'add',
  requiredPremiseIds: ['p1'],
  reasoning: { id: 'r-new', title: '新增推理', type: 'reasoning', reasoning: 'new inference' },
  conclusion: { id: 'c-new', title: '新增结论', type: 'hypothesis', reasoning: 'new result' },
});
assert.equal(added.errors.length, 0);
assert.deepEqual(added.nodes.find(item => item.id === 'r-new')?.premises, ['p1']);
assert.deepEqual(added.nodes.find(item => item.id === 'c-new')?.premises, ['r-new']);

console.log('Knowledge editing protocol regression tests passed');
