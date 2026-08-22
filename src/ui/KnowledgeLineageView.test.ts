import assert from 'node:assert/strict';
import {
  KNOWLEDGE_HISTORY_COLOR,
  KNOWLEDGE_OPPOSITION_COLOR,
  lineageColorForNode,
  nextKnowledgeVisibilityMode,
  nodeBelongsInLineageScene,
  nodeShouldPulse,
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

// Pending gray/red proposals are the explicit all-mode exception.
for (const pending of [pendingHistory, pendingOpposition]) {
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'current'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'personal'), true);
  assert.equal(nodeVisibleInKnowledgeMode(pending, 'all'), true);
}

assert.equal(nodeBelongsInLineageScene(history), true, 'legacy hidden flag must not delete formal history from scene data');
assert.equal(nodeBelongsInLineageScene(opposition), true);
assert.equal(nodeBelongsInLineageScene(rejected), false, 'rejected candidate remains audit-only');

assert.equal(lineageColorForNode(history), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(pendingHistory), KNOWLEDGE_HISTORY_COLOR);
assert.equal(lineageColorForNode(opposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(pendingOpposition), KNOWLEDGE_OPPOSITION_COLOR);
assert.equal(lineageColorForNode(current), null, 'current keeps its layer color');

assert.equal(nodeShouldPulse({ status:'pending' }), true);
assert.equal(nodeShouldPulse({ status:'disputed' }), true, 'gray/red or cascade revalidation must blink without changing role color');
assert.equal(nodeShouldPulse({ status:'verified' }), false);

console.log('Knowledge Lineage Current/Personal/All view tests passed');
