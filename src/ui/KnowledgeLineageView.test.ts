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
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false, 'ordinary red opposition remains hidden in Current');
assert.equal(nodeVisibleInKnowledgeMode(history, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'all'), true);

assert.equal(nodeVisibleInKnowledgeMode(current, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode(touchedHistory, 'personal'), false, 'non-owned gray history never enters Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, mastery:'mastered' }, 'personal'), true);
assert.equal(nodeVisibleInKnowledgeMode({ ...history, createdByMe:true }, 'personal'), true, 'own gray history remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...opposition, createdByMe:true }, 'personal'), true, 'own red opposition remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'falsified', mastery:'touched' }, 'personal'), false, 'non-owned red falsified current knowledge stays out of Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'falsified', createdByMe:true }, 'personal'), true, 'own falsified knowledge remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'disputed', mastery:'touched' }, 'personal'), false, 'non-owned revalidation stays out of Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...current, status:'disputed', createdByMe:true }, 'personal'), true, 'own revalidation remains visible in Personal');

for (const pending of [pendingHistory, pendingOpposition]) {
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'current'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'personal'), false);
  assert.equal(nodeVisibleInKnowledgeMode({ ...pending, createdByMe:true }, 'personal'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'all'), true);
}

const whiteHead: KnowledgeLineageViewNode = {
  id: 'reason-white', status: 'verified', mastery: 'none', hidden: false,
  lineage: {
    topicId: 'reason-topic', proposal: 'new', role: 'current', rank: 0,
    reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
  },
};
const redHead: KnowledgeLineageViewNode = {
  id: 'reason-red', status: 'verified', mastery: 'none', hidden: false,
  lineage: {
    topicId: 'reason-topic', proposal: 'opposition', targetId: 'reason-white', role: 'opposition', rank: 1,
    reasoningSide: 'opposition', reasoningSideRank: 0, reasoningDominant: true,
  },
};
const whiteHistory: KnowledgeLineageViewNode = {
  id: 'reason-white-old', status: 'verified', mastery: 'none', hidden: true,
  lineage: {
    topicId: 'reason-topic', proposal: 'optimization', targetId: 'reason-white', role: 'history', rank: 1,
    reasoningSide: 'normal', reasoningSideRank: 1, reasoningDominant: false,
  },
};
const redHistory: KnowledgeLineageViewNode = {
  id: 'reason-red-old', status: 'verified', mastery: 'none', hidden: true,
  lineage: {
    topicId: 'reason-topic', proposal: 'optimization', targetId: 'reason-red', role: 'opposition', rank: 2,
    reasoningSide: 'opposition', reasoningSideRank: 1, reasoningDominant: false,
  },
};
const whiteCounterCandidate: KnowledgeLineageViewNode = {
  id: 'reason-white-candidate', status: 'pending', mastery: 'none', hidden: false,
  lineage: {
    topicId: 'reason-topic', proposal: 'opposition', targetId: 'reason-red', role: 'candidate-opposition', rank: 0,
    reasoningSide: 'normal', reasoningSideRank: 0, reasoningDominant: false,
  },
};

// Both stable reasoning camp heads remain visible in Current regardless of which
// side dominates. Dominance is represented by logical-chain ownership, not color.
assert.equal(nodeVisibleInKnowledgeMode(whiteHead, 'current'), true);
assert.equal(nodeVisibleInKnowledgeMode(redHead, 'current'), true);
assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, mastery:'touched' }, 'personal'), false, 'non-owned red reasoning head stays out of Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...redHead, createdByMe:true }, 'personal'), true, 'own red reasoning head remains visible in Personal');
assert.equal(nodeVisibleInKnowledgeMode({ ...whiteHistory, mastery:'touched' }, 'personal'), false, 'non-owned gray reasoning history stays out of Personal');
assert.equal(nodeVisibleInKnowledgeMode(whiteCounterCandidate, 'personal'), false, 'non-owned pending white counter-candidate stays out of Personal');
assert.equal(lineageColorForNode(whiteHead), null, 'normal reasoning head keeps structural white');
assert.equal(lineageColorForNode(redHead), KNOWLEDGE_OPPOSITION_COLOR, 'opposition reasoning head stays red even when dominant');
assert.equal(lineageColorForNode(whiteHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(redHistory), KNOWLEDGE_HISTORY_COLOR, 'red-side older versions are gray history, not red heads');
assert.equal(lineageColorForNode(whiteCounterCandidate), null, 'a pending counter-opposition from the red side belongs to the white camp');

const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
let detailOpen = true;
const relatedElements = [
  { dataset: { relatedNodeId: 'history' } },
  { dataset: { relatedNodeId: 'opposition' } },
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
  assert.equal(nodeVisibleBecauseDetailIsOpen('unrelated'), false);
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), true, 'open detail temporarily reveals ordinary gray history');
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), true, 'open detail temporarily reveals ordinary red opposition');
  assert.equal(nodeVisibleInKnowledgeMode({ ...history, mastery:'touched' }, 'personal'), false, 'open detail must not leak non-owned gray history into Personal');
  assert.equal(nodeVisibleInKnowledgeMode({ ...opposition, mastery:'touched' }, 'personal'), false, 'open detail must not leak non-owned red opposition into Personal');
  assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'current'), true, 'white-side reasoning history is reachable from its head');
  assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'current'), true, 'red-side reasoning history is reachable from its head');
  assert.equal(nodeVisibleInKnowledgeMode(rejected, 'current'), false, 'detail context never resurrects rejected audit-only nodes');
  assert.equal(edgeVisibleInKnowledgeMode(current, history, 'current', true, () => false), true);
  assert.equal(edgeVisibleInKnowledgeMode(current, opposition, 'current', true, () => false), true);
  detailOpen = false;
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), false);
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false);
  assert.equal(nodeVisibleInKnowledgeMode(whiteHistory, 'current'), false);
  assert.equal(nodeVisibleInKnowledgeMode(redHistory, 'current'), false);
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
assert.equal(nodeBelongsInLineageScene(rejected), false);

assert.equal(lineageColorForNode(history), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(pendingHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(opposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(pendingOpposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(current), null);

assert.equal(nodeShouldPulse({ status:'pending' }), true);
assert.equal(nodeShouldPulse({ status:'disputed' }), true);
assert.equal(nodeShouldPulse({ status:'verified' }), false);

console.log('Knowledge Lineage Current/Personal/All and reasoning two-camp visibility tests passed');
