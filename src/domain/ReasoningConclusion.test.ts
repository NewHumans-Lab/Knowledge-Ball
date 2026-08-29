import assert from 'node:assert/strict';
import {
  bindReasoningConclusions,
  reasoningConclusionBindingFor,
  resolveReasoningConclusion,
  validateReasoningConclusionBindings,
  type ReasoningConclusionSemanticNode,
} from './ReasoningConclusion';

function node(
  id: string,
  type: string,
  premises: string[] = [],
  lineage?: ReasoningConclusionSemanticNode['lineage'],
  status: ReasoningConclusionSemanticNode['status'] = 'verified',
  hidden = false,
): ReasoningConclusionSemanticNode {
  return { id, type, premises, lineage, status, hidden };
}

const ordinaryConclusion: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c', 'fact', ['r']),
];
bindReasoningConclusions(ordinaryConclusion);
assert.equal(resolveReasoningConclusion('r', ordinaryConclusion)?.id, 'c', 'any ordinary Knowledge ball may be the concrete conclusion; no dedicated conclusion type exists');
assert.equal(reasoningConclusionBindingFor(ordinaryConclusion[1]!)?.conclusionId, 'c');
assert.deepEqual(validateReasoningConclusionBindings(ordinaryConclusion), []);

const dualReasoning: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('rw', 'reasoning', ['p'], {
    topicId:'reason-topic', proposal:'new', role:'current', rank:0,
    reasoningSide:'normal', reasoningSideRank:0, reasoningDominant:false,
  }),
  node('rr', 'reasoning', ['p'], {
    topicId:'reason-topic', proposal:'opposition', targetId:'rw', role:'current', rank:0,
    reasoningSide:'opposition', reasoningSideRank:0, reasoningDominant:true,
  }),
  node('rw-old', 'reasoning', ['p'], {
    topicId:'reason-topic', proposal:'optimization', targetId:'rw', role:'history', rank:1,
    reasoningSide:'normal', reasoningSideRank:1, reasoningDominant:false,
  }),
  node('c', 'theorem', ['rw']),
];
bindReasoningConclusions(dualReasoning);
for (const id of ['rw','rr','rw-old']) {
  assert.equal(
    reasoningConclusionBindingFor(dualReasoning.find(item => item.id === id)!)?.conclusionId,
    'c',
    `${id} must inherit the exact concrete conclusion through its Reasoning target chain`,
  );
}

// If the conclusion itself later gets a new immutable version, the old Reasoning
// stays pinned to the old concrete ball instead of jumping to the topic Current.
const conclusionVersions: ReasoningConclusionSemanticNode[] = [
  node('p-old', 'fact'),
  node('r-old', 'reasoning', ['p-old'], { topicId:'r-old-topic', proposal:'new', role:'current', rank:0 }),
  node('p-new', 'fact'),
  node('r-new', 'reasoning', ['p-new'], { topicId:'r-new-topic', proposal:'new', role:'current', rank:0 }),
  node('c-old', 'theorem', ['r-old'], {
    topicId:'c-topic', proposal:'new', role:'history', rank:1,
  }, 'verified', true),
  node('c-new', 'theorem', ['r-old','r-new'], {
    topicId:'c-topic', proposal:'optimization', targetId:'c-old', role:'current', rank:0,
  }),
];
bindReasoningConclusions(conclusionVersions);
const oldBinding = reasoningConclusionBindingFor(conclusionVersions.find(item => item.id === 'r-old')!);
assert.equal(oldBinding?.conclusionId, 'c-old', 'old Reasoning must stay with the concrete conclusion ball it originally served');
assert.equal(oldBinding?.lineage?.role, 'history');
assert.equal(oldBinding?.hidden, true, 'visibility receives the concrete conclusion hidden state');
assert.equal(reasoningConclusionBindingFor(conclusionVersions.find(item => item.id === 'r-new')!)?.conclusionId, 'c-new', 'a newly linked Reasoning may serve the newer concrete conclusion ball');

const sameTopicVersions: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c-old', 'theorem', ['r'], { topicId:'c-topic', proposal:'new', role:'history', rank:1 }),
  node('c-current', 'theorem', ['r'], { topicId:'c-topic', proposal:'optimization', targetId:'c-old', role:'current', rank:0 }),
];
assert.equal(resolveReasoningConclusion('r', sameTopicVersions)?.id, 'c-old', 'immutable conclusion versioning must keep Reasoning on the lineage root it originally served');

const ambiguous: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c1', 'fact', ['r']),
  node('c2', 'theorem', ['r']),
];
bindReasoningConclusions(ambiguous);
assert.equal(reasoningConclusionBindingFor(ambiguous[1]!), undefined, 'invalid multi-conclusion legacy data must not crash layout or invent an owner');
assert.ok(validateReasoningConclusionBindings(ambiguous).some(error => error.includes('exactly one concrete conclusion ball')));

const unbound: ReasoningConclusionSemanticNode[] = [node('p', 'fact'), node('r', 'reasoning', ['p'])];
assert.ok(validateReasoningConclusionBindings(unbound).some(error => error.includes('must serve one concrete ordinary conclusion')));

console.log('Reasoning-to-concrete-conclusion semantic binding regression tests passed');
