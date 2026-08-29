import assert from 'node:assert/strict';
import {
  KNOWLEDGE_HISTORY_COLOR,
  KNOWLEDGE_OPPOSITION_COLOR,
  edgeVisibleInKnowledgeMode,
  lineageColorForNode,
  nextKnowledgeVisibilityMode,
  nodeBelongsInLineageScene,
  nodeShouldPulse,
  nodeVisibleBecauseDetailIsOpen,
  nodeVisibleInKnowledgeMode,
  visibilityModeLabel,
  type KnowledgeLineageViewNode,
} from './KnowledgeLineageView';

function node(
  id: string,
  role: NonNullable<KnowledgeLineageViewNode['lineage']>['role'],
  status: KnowledgeLineageViewNode['status'] = 'verified',
  mastery: KnowledgeLineageViewNode['mastery'] = 'none',
  createdByMe = false,
): KnowledgeLineageViewNode {
  return {
    id,
    status,
    mastery,
    createdByMe,
    hidden: role === 'history' || role === 'opposition' || role === 'rejected',
    lineage: {
      topicId: 'topic',
      proposal: role === 'candidate-opposition' || role === 'opposition' ? 'opposition'
        : role === 'candidate-history' || role === 'history' ? 'optimization' : 'new',
      targetId: role === 'candidate-opposition' || role === 'opposition' || role === 'candidate-history' || role === 'history' ? 'current' : undefined,
      role,
      rank: role === 'history' || role === 'opposition' ? 1 : 0,
    },
  };
}

const verifiedConclusion = Object.freeze({
  conclusionId: 'served-conclusion',
  conclusionTopicId: 'served-conclusion-topic',
  status: 'verified' as const,
  hidden: false,
  lineage: {
    topicId: 'served-conclusion-topic', proposal: 'new' as const, role: 'current' as const, rank: 0,
  },
});
const grayConclusion = Object.freeze({
  conclusionId: 'served-conclusion-old',
  conclusionTopicId: 'served-conclusion-topic',
  status: 'verified' as const,
  hidden: true,
  lineage: {
    topicId: 'served-conclusion-topic', proposal: 'optimization' as const, targetId: 'served-conclusion', role: 'history' as const, rank: 1,
  },
});
const redConclusion = Object.freeze({
  conclusionId: 'served-conclusion-red',
  conclusionTopicId: 'served-conclusion-red-topic',
  status: 'falsified' as const,
  hidden: true,
  lineage: {
    topicId: 'served-conclusion-red-topic', proposal: 'opposition' as const, targetId: 'served-conclusion', role: 'opposition' as const, rank: 1,
  },
});
const pendingConclusion = Object.freeze({
  conclusionId: 'served-conclusion-pending',
  conclusionTopicId: 'served-conclusion-pending',
  status: 'pending' as const,
  hidden: false,
  lineage: {
    topicId: 'served-conclusion-pending', proposal: 'new' as const, role: 'current' as const, rank: 0,
  },
});

assert.equal(nextKnowledgeVisibilityMode('current'), 'personal');
assert.equal(nextKnowledgeVisibilityMode('personal'), 'all');
assert.equal(nextKnowledgeVisibilityMode('all'), 'current');
assert.equal(visibilityModeLabel('current'), '当前');
assert.equal(visibilityModeLabel('personal'), '个人');
assert.equal(visibilityModeLabel('all'), '全部');

const current = node('current', 'current');
const history = node('history', 'history');
const opposition = node('opposition', 'opposition');
const touchedHistory = node('history-touched', 'history', 'verified', 'touched');
const pendingHistory = node('candidate-history', 'candidate-history', 'pending');
const pendingOpposition = node('candidate-opposition', 'candidate-opposition', 'pending');
const rejected = node('rejected', 'rejected', 'falsified');

assert.equal(nodeVisibleInKnowledgeMode(current, 'current'), true);
assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(history, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'all'), true);

// Pending is the absolute Current priority, even for lineage candidates that
// would otherwise be gray/red/hidden.
for (const pending of [pendingHistory, pendingOpposition]) {
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'current'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'personal'), false);
  assert.equal(nodeVisibleInKnowledgeMode({ ...pending, createdByMe:true }, 'personal'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'all'), true);
}

// Personal = own submissions, plus lit nodes that normally belong in Current.
assert.equal(nodeVisibleInKnowledgeMode(current, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...current, mastery:'mastered' }, 'personal'), true);
assert.equal(nodeVisibleInKnowledgeMode(touchedHistory, 'personal'), false, 'lit gray history is not normally Current-visible');
assert.equal(nodeVisibleInKnowledgeMode({ ...history, createdByMe:true }, 'personal'), true, 'own gray ordinary history remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...opposition, createdByMe:true }, 'personal'), true, 'own red ordinary opposition remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'disputed', mastery:'touched' }, 'personal'), true, 'disputed is not a blanket Personal ban when the current ball is lit');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'disputed', createdByMe:true }, 'personal'), true);

const whiteHead: KnowledgeLineageViewNode = {
  id: 'reason-white', type: 'reasoning', status: 'verified', mastery: 'none', hidden: false,
  reasoningConclusion: verifiedConclusion,
  lineage: {
    topicId: 'reason-topic', proposal: 'new', role: 'current', rank: 0,
    reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
  },
};
const redHead: KnowledgeLineageViewNode = {
  id: 'reason-red', type: 'reasoning', status: 'verified', mastery: 'none', hidden: false,
  reasoningConclusion: verifiedConclusion,
  lineage: {
    topicId: 'reason-topic', proposal: 'opposition', targetId: 'reason-white', role: 'current', rank: 0,
    reasoningSide: 'opposition', reasoningSideRank: 0, reasoningDominant: true,
  },
};
const whiteWinningHead: KnowledgeLineageViewNode = {
  ...whiteHead,
  lineage: { ...whiteHead.lineage!, reasoningDominant: true },
};
const redLosingHead: KnowledgeLineageViewNode = {
  ...redHead,
  lineage: { ...redHead.lineage!, reasoningDominant: false },
};
const whiteHistory: KnowledgeLineageViewNode = {
  id: 'reason-white-old', type: 'reasoning', status: 'verified', mastery: 'none', hidden: true,
  reasoningConclusion: verifiedConclusion,
  lineage: {
    topicId: 'reason-topic', proposal: 'optimization', targetId: 'reason-white', role: 'history', rank: 1,
    reasoningSide: 'normal', reasoningSideRank: 1, reasoningDominant: false,
  },
};
const redHistory: KnowledgeLineageViewNode = {
  id: 'reason-red-old', type: 'reasoning', status: 'verified', mastery: 'none', hidden: true,
  reasoningConclusion: verifiedConclusion,
  lineage: {
    topicId: 'reason-topic', proposal: 'optimization', targetId: 'reason-red', role: 'opposition', rank: 1,
    reasoningSide: 'opposition', reasoningSideRank: 1, reasoningDominant: false,
  },
};
const whiteCounterCandidate: KnowledgeLineageViewNode = {
  id: 'reason-white-candidate', type: 'reasoning', status: 'pending', mastery: 'none', hidden: false,
  reasoningConclusion: verifiedConclusion,
  lineage: {
    topicId: 'reason-topic', proposal: 'opposition', targetId: 'reason-red', role: 'candidate-opposition', rank: 0,
    reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
  },
};

// Current: a white winner is visible. If red wins, the entire stable Reasoning
// family disappears from Current; All still exposes every camp/history ball.
assert.equal(nodeVisibleInKnowledgeMode(whiteWinningHead, 'current'), true, 'dominant white head is the visible surviving inference');
assert.equal(nodeVisibleInKnowledgeMode(redLosingHead, 'current'), false, 'losing red head stays hidden when white wins');
assert.equal(nodeVisibleInKnowledgeMode(whiteHead, 'current'), false, 'losing white head must be hidden when red wins');
assert.equal(nodeVisibleInKnowledgeMode(redHead, 'current'), false, 'dominant red means no stable Reasoning ball is shown in Current');
assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'current'), false, 'winner/loser histories stay hidden');
assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(whiteHead, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(redHead, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'all'), true);

// Pending Reasoning overrides conclusion and winner/history hiding in Current.
assert.equal(nodeVisibleInKnowledgeMode(whiteCounterCandidate, 'current'), true);
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteCounterCandidate, reasoningConclusion:grayConclusion }, 'current'), true, 'pending Reasoning stays visible even when its conclusion is gray');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteCounterCandidate, reasoningConclusion:redConclusion }, 'current'), true, 'pending Reasoning stays visible even when its conclusion is red');

// Non-pending Reasoning is subordinate to its concrete conclusion, and a red
// winner remains hidden even when that conclusion itself is Current/pending-visible.
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, reasoningConclusion:grayConclusion }, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, reasoningConclusion:redConclusion }, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, reasoningConclusion:pendingConclusion }, 'current'), false, 'red-winning stable Reasoning stays hidden in Current');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteWinningHead, reasoningConclusion:pendingConclusion }, 'current'), true, 'white winner may display when its conclusion is pending-visible');

// Personal: own Reasoning may expose its own losing/history ball, but never when
// the concrete conclusion is gray/red/hidden. Lit non-owned Reasoning must first
// be normally Current-visible, so a red winner does not enter Personal merely by
// being lit; an owned red winner remains inspectable under the Personal rule.
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, mastery:'touched' }, 'personal'), false, 'lit red winner is not normally Current-visible');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteWinningHead, mastery:'touched' }, 'personal'), true, 'lit white winner enters Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteHead, mastery:'touched' }, 'personal'), false, 'lit losing Reasoning does not enter Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, createdByMe:true }, 'personal'), true, 'own red winner remains inspectable in Personal while conclusion is normal');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteHead, createdByMe:true }, 'personal'), true, 'own losing Reasoning may be inspected in Personal while conclusion is normal');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteHistory, createdByMe:true }, 'personal'), true, 'own Reasoning history may be inspected in Personal while conclusion is normal');
assert.equal(nodeVisibleInKnowledgeMode(whiteCounterCandidate, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteCounterCandidate, createdByMe:true }, 'personal'), true);
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, createdByMe:true, reasoningConclusion:grayConclusion }, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteHead, createdByMe:true, reasoningConclusion:redConclusion }, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, mastery:'mastered', reasoningConclusion:grayConclusion }, 'personal'), false);
assert.equal(
  edgeVisibleInKnowledgeMode(
    { ...redHead, mastery:'mastered', reasoningConclusion:grayConclusion },
    { ...current, mastery:'mastered' },
    'personal',
    true,
    () => false,
  ),
  false,
  'a hidden conclusion-owned Reasoning ball must also remove its Personal edge',
);

assert.equal(lineageColorForNode(whiteHead), null);
assert.equal(lineageColorForNode(redHead), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(whiteHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(redHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(whiteCounterCandidate), null);

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
let detailOpen = true;
const relatedElements = [
  { dataset: { relatedNodeId: 'history' } },
  { dataset: { relatedNodeId: 'opposition' } },
  { dataset: { relatedNodeId: 'reason-white' } },
  { dataset: { relatedNodeId: 'reason-red' } },
  { dataset: { relatedNodeId: 'reason-white-old' } },
  { dataset: { relatedNodeId: 'reason-red-old' } },
];
const fakeDetailRoot = {
  classList: { contains: (name: string) => name === 'open' && detailOpen },
  dataset: { nodeId: 'current' },
  querySelectorAll: () => relatedElements,
};
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { getElementById: (id: string) => id === 'nodeDetailOverlay' ? fakeDetailRoot : null },
});
try {
  assert.equal(nodeVisibleBecauseDetailIsOpen('current'), true);
  assert.equal(nodeVisibleBecauseDetailIsOpen('history'), true);
  assert.equal(nodeVisibleBecauseDetailIsOpen('opposition'), true);
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), true, 'ordinary gray history may still be temporarily revealed by detail');
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), true, 'ordinary red opposition may still be temporarily revealed by detail');
  assert.equal(nodeVisibleInKnowledgeMode(whiteHead, 'current'), false, 'detail must not resurrect the losing Reasoning head');
  assert.equal(nodeVisibleInKnowledgeMode(redHead, 'current'), false, 'detail must not resurrect a red-winning Reasoning head');
  assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'current'), false, 'detail must not resurrect Reasoning history');
  assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'current'), false, 'detail must not resurrect losing/winning Reasoning history');
  assert.equal(nodeVisibleInKnowledgeMode(rejected, 'current'), false);
  detailOpen = false;
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), false);
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false);
} finally {
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
}

assert.equal(nodeBelongsInLineageScene(history), true);
assert.equal(nodeBelongsInLineageScene(opposition), true);
assert.equal(nodeBelongsInLineageScene(whiteHead), true);
assert.equal(nodeBelongsInLineageScene(redHead), true);
assert.equal(nodeBelongsInLineageScene(whiteHistory), true);
assert.equal(nodeBelongsInLineageScene(redHistory), true);
assert.equal(nodeBelongsInLineageScene({ ...whiteHead, reasoningConclusion:undefined }), false, 'unbound Reasoning must not degrade into a free-floating scene ball');
assert.equal(nodeBelongsInLineageScene(rejected), false);

assert.equal(lineageColorForNode(history), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(pendingHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(opposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(pendingOpposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(current), null);

assert.equal(nodeShouldPulse({ status:'pending' }), true);
assert.equal(nodeShouldPulse({ status:'disputed' }), true);
assert.equal(nodeShouldPulse({ status:'verified' }), false);

console.log('Knowledge Lineage pending-first Current, Personal, All and red-winner-hidden Reasoning visibility tests passed');