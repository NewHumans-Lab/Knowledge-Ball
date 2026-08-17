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
  node_id:'pending-1', agree_count:2, disagree_count:1, required_votes:4, my_side:'AGREE', my_balance:'-1.000000',
}, 'pending-1'), {
  nodeId:'pending-1', agreeCount:2, disagreeCount:1, requiredVotes:4, mySide:'AGREE', myBalance:'-1.000000',
});
assert.throws(() => parsePendingKnowledgeVote({ node_id:'other', agree_count:0, disagree_count:0, required_votes:1, my_side:null }, 'pending-1'), /节点不匹配/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:-1, disagree_count:0, required_votes:1, my_side:null }, 'pending-1'), /无效赞成票数/);
assert.throws(() => parsePendingKnowledgeVote({ node_id:'pending-1', agree_count:0, disagree_count:0, required_votes:1, my_side:'MAYBE' }, 'pending-1'), /无效投票状态/);

const authUi = readFileSync('src/ui/AuthUi.ts', 'utf8');
assert.match(authUi, /panelClose\.textContent = '❌'/, 'node detail must expose an explicit top-right return/close affordance');
assert.match(authUi, /node\.status !== 'pending'/, 'vote controls must be pending-only');
assert.match(authUi, /data-vote-side=\"AGREE\"/, 'pending detail must expose an agree action');
assert.match(authUi, /data-vote-side=\"DISAGREE\"/, 'pending detail must expose a disagree action');
assert.match(authUi, /−1 能量/g, 'both vote buttons must label the one-energy stake');
assert.match(authUi, /account\.castPendingKnowledgeVote/, 'vote UI must call the real account vote RPC rather than fake a local decrement');
assert.match(authUi, /await refreshCachedAccount\(\)/, 'successful votes must refresh account energy display');
assert.match(authUi, /observe\(panelTitle/, 'panel enhancements must keep the safe title-only observer boundary');
assert.doesNotMatch(authUi, /observe\(panel,\s*\{\s*subtree:true/, 'vote UI must not recreate the old panel-subtree MutationObserver feedback loop');
console.log('Account formatting and pending vote regression checks passed');
