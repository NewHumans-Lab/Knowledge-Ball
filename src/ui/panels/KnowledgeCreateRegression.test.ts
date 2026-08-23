import { strict as assert } from 'node:assert';
import {
  isReasoningConclusionCandidate,
  isReasoningPremiseCandidate,
  type KnowledgeCreateNode,
} from './KnowledgeCreateController';

const node = (overrides: Partial<KnowledgeCreateNode> = {}): KnowledgeCreateNode => ({
  id: 'node',
  title: 'Node',
  type: 'fact',
  status: 'verified',
  ...overrides,
});

assert.equal(isReasoningPremiseCandidate(node()), true);
assert.equal(isReasoningPremiseCandidate(node({ type: 'reasoning' })), false, 'reasoning ball must not appear as a premise');
assert.equal(isReasoningPremiseCandidate(node({ status: 'pending' })), false, 'pending ball must not appear as a premise');
assert.equal(isReasoningPremiseCandidate(node({ lineage: { topicId: 't', proposal: 'new', role: 'history', rank: 1 } })), false, 'history ball must not appear as a premise');
assert.equal(isReasoningPremiseCandidate(node({ lineage: { topicId: 't', proposal: 'opposition', role: 'opposition', rank: 1 } })), false, 'opposition ball must not appear as a premise');
assert.equal(isReasoningPremiseCandidate(node({ type: 'logic-symbol' })), true, 'product rule excludes reasoning type, not logic-symbol');

assert.equal(isReasoningConclusionCandidate(node()), true);
assert.equal(isReasoningConclusionCandidate(node({ status: 'pending' })), true, 'pending non-reasoning ball may be selected as a conclusion');
assert.equal(isReasoningConclusionCandidate(node({ lineage: { topicId: 't', proposal: 'new', role: 'history', rank: 1 } })), true, 'history non-reasoning ball may be selected as a conclusion');
assert.equal(isReasoningConclusionCandidate(node({ lineage: { topicId: 't', proposal: 'opposition', role: 'opposition', rank: 1 } })), true, 'opposition non-reasoning ball may be selected as a conclusion');
assert.equal(isReasoningConclusionCandidate(node({ type: 'reasoning' })), false, 'reasoning ball must not appear as a conclusion');

console.log('Knowledge create picker eligibility regression tests passed');
