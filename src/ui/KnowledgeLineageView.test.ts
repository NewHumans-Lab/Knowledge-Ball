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
): KnowledgeLineageViewNode {
  return {
    id,
    status,
    mastery,
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
const suppressedHistory: KnowledgeLineageViewNode = {
  ...node('suppressed-history', 'history', 'verified', 'mastered'),
  lineage: {
    ...node('suppressed-history-base', 'history').lineage!,
    topicId: 'suppressed-topic',
    suppressedByOpposition: true,
  },
};
const suppressedOpposition: KnowledgeLineageViewNode = {
  ...node('suppressed-opposition', 'opposition', 'verified', 'mastered'),
  lineage: {
    ...node('suppressed-opposition-base', 'opposition').lineage!,
    topicId: 'suppressed-topic',
    proposal: 'opposition',
    suppressedByOpposition: true,
  },
};

assert.equal(nodeVisibleInKnowledgeMode(current, 'current'), true);
assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false);
assert.equal(nodeVisibleInKnowledgeMode(history, 'all'), true);
assert.equal(nodeVisibleInKnowledgeMode(opposition, 'all'), true);

// Preserve the old Personal behavior: untouched knowledge is hidden, while a
// touched historical/opposing immutable ball remains part of personal history.
assert.equal(nodeVisibleInKnowledgeMode(current, 'personal'), false);
assert.equal(nodeVisibleInKnowledgeMode(touchedHistory, 'personal'), true);
assert.equal(nodeVisibleInKnowledgeMode({ ...current, mastery:'mastered' }, 'personal'), true);

// A successful opposition to a reasoning node is not a viewpoint swap. The red
// winning opposition remains red, the former white reasoning is gray history,
// and both are audit-only: even personal mastery cannot reveal them outside All.
for (const suppressedNode of [suppressedHistory, suppressedOpposition]) {
  assert.equal(nodeVisibleInKnowledgeMode(suppressedNode, 'current'), false);
  assert.equal(nodeVisibleInKnowledgeMode(suppressedNode, 'personal'), false);
  assert.equal(nodeVisibleInKnowledgeMode(suppressedNode, 'all'), true);
}
assert.equal(lineageColorForNode(suppressedHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(suppressedOpposition), KNOWLEDGE_OPPOSITION_COLOR);

// Pending gray/red proposals are the explicit all-mode exception.
for (const pending of [pendingHistory, pendingOpposition]) {
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'current'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'personal'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'all'), true);
}

// Opening detail is a temporary context lens. Related gray/red balls become
// visible even in Current mode, and edge visibility follows exactly the same
// endpoint predicate. Closing detail removes both ball and line visibility.
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
let detailOpen = true;
const relatedElements = [
  { dataset: { relatedNodeId: 'history' } },
  { dataset: { relatedNodeId: 'opposition' } },
  { dataset: { relatedNodeId: 'suppressed-history' } },
  { dataset: { relatedNodeId: 'suppressed-opposition' } },
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
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), true, 'open detail must temporarily reveal related gray history');
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), true, 'open detail must temporarily reveal related red opposition');
  assert.equal(nodeVisibleInKnowledgeMode(suppressedHistory, 'current'), false, 'suppressed reasoning history remains All-only even with detail open');
  assert.equal(nodeVisibleInKnowledgeMode(suppressedOpposition, 'current'), false, 'winning red reasoning opposition remains All-only even with detail open');
  assert.equal(nodeVisibleInKnowledgeMode(rejected, 'current'), false, 'detail context must never resurrect rejected audit-only nodes');
  assert.equal(edgeVisibleInKnowledgeMode(current, history, 'current', true, () => false), true, 'gray lineage line appears with its two visible endpoint balls');
  assert.equal(edgeVisibleInKnowledgeMode(current, opposition, 'current', true, () => false), true, 'red lineage line appears with its two visible endpoint balls');
  detailOpen = false;
  assert.equal(nodeVisibleInKnowledgeMode(history, 'current'), false, 'closing detail restores Current-mode gray-ball hiding');
  assert.equal(nodeVisibleInKnowledgeMode(opposition, 'current'), false, 'closing detail restores Current-mode red-ball hiding');
  assert.equal(edgeVisibleInKnowledgeMode(current, history, 'current', true, () => false), false, 'gray lineage line hides with its endpoint ball');
  assert.equal(edgeVisibleInKnowledgeMode(current, opposition, 'current', true, () => false), false, 'red lineage line hides with its endpoint ball');
} finally {
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
}

assert.equal(nodeBelongsInLineageScene(history), true, 'legacy hidden flag must not delete formal history from scene data');
assert.equal(nodeBelongsInLineageScene(opposition), true);
assert.equal(nodeBelongsInLineageScene(suppressedHistory), true, 'suppressed gray reasoning must remain available to All mode');
assert.equal(nodeBelongsInLineageScene(suppressedOpposition), true, 'suppressed red reasoning opposition must remain available to All mode');
assert.equal(nodeBelongsInLineageScene(rejected), false, 'rejected candidate remains audit-only');

assert.equal(lineageColorForNode(history), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(pendingHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(opposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(pendingOpposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(current), null, 'current keeps its layer color');

assert.equal(nodeShouldPulse({ status:'pending' }), true);
assert.equal(nodeShouldPulse({ status:'disputed' }), true, 'gray/red or cascade revalidation must blink without changing role color');
assert.equal(nodeShouldPulse({ status:'verified' }), false);

console.log('Knowledge Lineage Current/Personal/All and detail-line visibility tests passed');
