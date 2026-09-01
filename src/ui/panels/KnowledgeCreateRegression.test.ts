import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { setLocale } from '../../i18n/Locale';
import {
  SUPPLEMENTAL_SYSTEM_UI_TEXT,
  knowledgeLayerHelp,
  knowledgeLayerLabel,
  systemUiText,
} from '../../i18n/SystemUiText';
import {
  isReasoningConclusionCandidate,
  isReasoningPremiseCandidate,
  type KnowledgeCreateNode,
} from './KnowledgeCreateController';

const source = readFileSync('src/ui/panels/KnowledgeCreateController.ts', 'utf8');
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

for (const [key, pair] of Object.entries(SUPPLEMENTAL_SYSTEM_UI_TEXT)) {
  assert.equal(typeof pair['zh-CN'], 'string', `${key} must define zh-CN copy`);
  assert.equal(typeof pair.en, 'string', `${key} must define English copy`);
  assert(pair['zh-CN'].length > 0 && pair.en.length > 0, `${key} copies must not be empty`);
}

setLocale('en');
assert.equal(systemUiText('create.addKnowledge'), 'Add knowledge');
assert.equal(knowledgeLayerLabel('inner'), 'Layer 1 · Semantics and foundational facts');
for (const layer of ['inner', 'middle', 'outer'] as const) {
  assert(!/[\u3400-\u9FFF]/u.test(knowledgeLayerHelp(layer)), `English ${layer} help must contain no Chinese system characters`);
}
assert(!/[\u3400-\u9FFF]/u.test(systemUiText('create.reasoningSingleConclusionNote')), 'English reasoning note must contain no Chinese system characters');
assert.equal(systemUiText('create.nodeSubmitted', { title: '用户原文' }), 'Node submitted: 用户原文', 'system wrapper localizes while user-authored title stays byte-for-byte unchanged');

setLocale('zh-CN');
assert.equal(systemUiText('create.addKnowledge'), '新增知识');
assert.equal(knowledgeLayerLabel('inner'), '第一层 · 语义与基础事实');
assert(knowledgeLayerHelp('inner').includes('静态语义关系'), 'Chinese layer help must preserve the canonical semantic contract');

assert(!source.includes('KNOWLEDGE_LAYER_HELP'), 'create UI must not import presentation prose from the domain layer');
assert(source.includes("subscribeLocale(() => this.refreshLocale())"), 'open create UI must refresh immediately on locale changes');
assert(source.includes('const title = this.root.querySelector<HTMLInputElement>'), 'locale refresh must snapshot the current user-authored title draft');
assert(source.includes('const description = this.root.querySelector<HTMLTextAreaElement>'), 'locale refresh must snapshot user-authored description/reasoning drafts');
assert(source.includes('if (titleInput) titleInput.value = title'), 'locale refresh must restore the user-authored title without translation');
assert(source.includes('if (descriptionInput) descriptionInput.value = description'), 'locale refresh must restore the user-authored description without translation');
assert(source.includes('if (reasoningInput) reasoningInput.value = reasoning'), 'locale refresh must restore the user-authored reasoning without translation');
assert(source.includes('this.selectedPremises') && source.includes('this.selectedConclusions'), 'locale refresh must preserve picker selection state owned by the controller');
assert(source.includes('escapeHtml(node.title)'), 'user-authored picker node titles must render verbatim instead of going through i18n');
assert.equal(/[\u3400-\u9FFF]/u.test(source), false, 'KnowledgeCreateController must not contain hard-coded CJK system copy');

console.log('Knowledge create picker eligibility and i18n regression tests passed');
