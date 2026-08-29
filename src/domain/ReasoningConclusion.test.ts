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
): ReasoningConclusionSemanticNode {
  return { id, type, premises, lineage, status };
}

const ordinaryConclusion: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c', 'fact', ['r']),
];
bindReasoningConclusions(ordinaryConclusion);
assert.equal(resolveReasoningConclusion('r', ordinaryConclusion)?.id, 'c', 'any ordinary Knowledge ball may be the conclusion; no dedicated conclusion type exists');
assert.equal(reasoningConclusionBindingFor(ordinaryConclusion[1]!)?.conclusionId, 'c');
assert.deepEqual(validateReasoningConclusionBindings(ordinaryConclusion), []);

const dualReasoning: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('rw', 'reasoning', ['p'], {
    topicId:'reason-topic', proposal:'new', role:'current', rank:0,
    reasoningSide:'normal', reasoningSideRank:0, reasoningDominant:false,
  }),
  node('rr', 'reasoning', ['p'], {
    topicId:'reason-topic', proposal:'opposition', targetId:'rw', role:'opposition', rank:1,
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
    `${id} must stay semantically attached to the same served conclusion despite reasoning-side color/history`,
  );
}

const conclusionVersions: ReasoningConclusionSemanticNode[] = [
  node('p-old', 'fact'),
  node('r-old', 'reasoning', ['p-old'], { topicId:'r-old-topic', proposal:'new', role:'current', rank:0 }),
  node('p-new', 'fact'),
  node('r-new', 'reasoning', ['p-new'], { topicId:'r-new-topic', proposal:'new', role:'current', rank:0 }),
  node('c-old', 'theorem', ['r-old'], {
    topicId:'c-topic', proposal:'optimization', targetId:'c-new', role:'history', rank:1,
  }),
  node('c-new', 'theorem', ['r-new'], {
    topicId:'c-topic', proposal:'new', role:'current', rank:0,
  }),
];
bindReasoningConclusions(conclusionVersions);
assert.equal(reasoningConclusionBindingFor(conclusionVersions.find(item => item.id === 'r-old')!)?.conclusionId, 'c-old', 'an older reasoning family keeps following its directly linked gray immutable conclusion instead of jumping to the new current');
assert.equal(reasoningConclusionBindingFor(conclusionVersions.find(item => item.id === 'r-old')!)?.lineage?.role, 'history');
assert.equal(reasoningConclusionBindingFor(conclusionVersions.find(item => item.id === 'r-new')!)?.conclusionId, 'c-new');

const sameTopicVersions: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c-current', 'theorem', ['r'], { topicId:'c-topic', proposal:'new', role:'current', rank:0 }),
  node('c-history', 'theorem', ['r'], { topicId:'c-topic', proposal:'optimization', targetId:'c-current', role:'history', rank:1 }),
];
assert.equal(resolveReasoningConclusion('r', sameTopicVersions)?.id, 'c-current', 'legacy same-topic versions prefer the directly linked current conclusion deterministically');

const ambiguous: ReasoningConclusionSemanticNode[] = [
  node('p', 'fact'),
  node('r', 'reasoning', ['p']),
  node('c1', 'fact', ['r']),
  node('c2', 'theorem', ['r']),
];
assert.throws(
  () => bindReasoningConclusions(ambiguous),
  /must serve exactly one conclusion topic/,
  'one reasoning family must never silently average or serve two independent conclusion topics',
);
assert.ok(validateReasoningConclusionBindings(ambiguous).some(error => error.includes('exactly one conclusion topic')));

const unbound: ReasoningConclusionSemanticNode[] = [node('p', 'fact'), node('r', 'reasoning', ['p'])];
assert.ok(validateReasoningConclusionBindings(unbound).some(error => error.includes('must serve one ordinary conclusion')));

console.log('Reasoning-to-conclusion semantic binding regression tests passed');
