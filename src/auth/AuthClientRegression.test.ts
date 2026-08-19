import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactEnergy, parsePendingKnowledgeVote } from './AuthClient';
import { safeAvatarUrl } from './AuthProfilePresentation';

for (const [input, output] of [['0.000000','0'], ['-0.000001','0'], ['-0.999999','0'], ['1.999999','1'], ['-1.000000','-1']] as const) {
  assert.equal(compactEnergy(input), output, `${input} must display as ${output}`);
}
assert.equal(safeAvatarUrl('https://cdn.example/avatar.png'), 'https://cdn.example/avatar.png');
assert.equal(safeAvatarUrl('javascript:alert(1)'), null);
assert.equal(safeAvatarUrl('http://example.test/avatar.png'), null);

assert.deepEqual(parsePendingKnowledgeVote({
  node_id:'pending-1', round_id:'round-1', agree_count:2, disagree_count:1, required_votes:4,
  my_side:'AGREE', my_balance:'-1.000000', verdict:'PENDING', close_reason:null,
  deadline:'2026-09-17T00:00:00+00:00', closed_at:null, policy_version:'ORIGINAL_DESIGN_V1',
}, 'pending-1'), {
  nodeId:'pending-1', roundId:'round-1', agreeCount:2, disagreeCount:1, requiredVotes:4,
  mySide:'AGREE', myBalance:'-1.000000', verdict:'PENDING', closeReason:null,
  deadline:'2026-09-17T00:00:00+00:00', closedAt:undefined, policyVersion:'ORIGINAL_DESIGN_V1',
});

assert.deepEqual(parsePendingKnowledgeVote({
  node_id:'pending-legacy', agree_count:0, disagree_count:0, required_votes:1, my_side:null,
}, 'pending-legacy'), {
  nodeId:'pending-legacy', agreeCount:0, disagreeCount:0, requiredVotes:1, mySide:null,
  myBalance:undefined, roundId:undefined, verdict:'PENDING', closeReason:null,
  deadline:undefined, closedAt:undefined, policyVersion:undefined,
}, 'client must remain rollout-compatible with the pre-round RPC shape');

const closed = parsePendingKnowledgeVote({
  node_id:'closed-1', round_id:'round-closed', agree_count:1, disagree_count:2, required_votes:2,
  my_side:'DISAGREE', my_balance:'1.000000', verdict:'INCORRECT', close_reason:'THRESHOLD',
  deadline:'2026-09-17T00:00:00+00:00', closed_at:'2026-08-18T00:00:00+00:00', policy_version:'ORIGINAL_DESIGN_V1',
}, 'closed-1');
assert.equal(closed.verdict, 'INCORRECT');
assert.equal(closed.closeReason, 'THRESHOLD');
assert.equal(closed.closedAt, '2026-08-18T00:00:00+00:00');

assert.throws(() => parsePendingKnowledgeVote({ node_id:'other', agree_count:0, disagree_count:0, required_votes:1, my_side:null }, 'pending-1'), /节点不匹配/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:-1, disagree_count:0, required_votes:1, my_side:null }, 'pending-1'), /无效赞成票数/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:0, disagree_count:0, required_votes:1, my_side:'MAYBE' }, 'pending-1'), /无效投票状态/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:0, disagree_count:0, required_votes:1, my_side:null, verdict:'MAYBE' }, 'pending-1'), /无效结算状态/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:0, disagree_count:0, required_votes:1, my_side:null, close_reason:'MANUAL' }, 'pending-1'), /无效结算原因/);

const authUi = readFileSync('src/ui/AuthUi.ts', 'utf8');
const syncEngine = readFileSync('src/sync/SyncEngine.ts', 'utf8');
const publicSyncCoordinator = readFileSync('src/sync/PublicKnowledgeSyncCoordinator.ts', 'utf8');
assert.match(authUi, /panelClose\.textContent = '❌'/, 'node detail must expose an explicit top-right return/close affordance');
assert.match(authUi, /node\.status !== 'pending'/, 'vote controls must be pending-only');
assert.match(authUi, /data-vote-side=\"AGREE\"/, 'pending detail must expose an agree action');
assert.match(authUi, /data-vote-side=\"DISAGREE\"/, 'pending detail must expose a disagree action');
assert.match(authUi, /−1 能量/g, 'both vote buttons must label the one-energy stake');
assert.match(authUi, /account\.castPendingKnowledgeVote/, 'vote UI must call the real account vote RPC rather than fake a local decrement');
assert.match(authUi, /await refreshCachedAccount\(\)/, 'successful votes/settlements must refresh account energy display');
assert.match(authUi, /VOTE_REFRESH_MS = 3_000/, 'the one active vote card must refresh its global tally promptly');
assert.match(authUi, /account\.getPendingKnowledgeVote\(nodeId\)/, 'active pending detail must re-read the authoritative all-network tally');
assert.match(authUi, /account\.settleExpiredPendingKnowledgeVotes\(50\)/, 'clients must trigger a low-frequency threshold\/deadline readiness sweep');
assert.match(authUi, /knowledge-ball:verdict-finalized/, 'finalized server verdicts must publish a graph-change signal');
assert.match(syncEngine, /PublicKnowledgeSyncCoordinator/, 'the sync engine, not account UI, must own public graph convergence');
assert.match(publicSyncCoordinator, /DEFAULT_PUBLIC_KNOWLEDGE_SYNC_INTERVAL_MS = 10_000/, 'already-open clients must periodically reconcile server events');
assert.match(publicSyncCoordinator, /knowledge-ball:verdict-finalized/, 'server verdict signal must trigger prompt public graph reconciliation');
assert.doesNotMatch(authUi, /REMOTE_GRAPH_SYNC_MS|scheduleRemoteGraphSync|requestGraphSync|syncEngine/, 'account UI must not own or reach through debug state to synchronize the public graph');
assert.match(authUi, /snapshot\.verdict === 'PENDING'/, 'closed rounds must stop accepting or polling ordinary votes');
assert.match(authUi, /observe\(panelTitle/, 'panel enhancements must keep the safe title-only observer boundary');
assert.doesNotMatch(authUi, /observe\(panel,\s*\{\s*subtree:true/, 'vote UI must not recreate the old panel-subtree MutationObserver feedback loop');
assert.doesNotMatch(authUi, /setInterval\(/, 'vote synchronization must not add permanent or per-node intervals');
console.log('Account formatting, pending vote, and public-sync ownership regression checks passed');
