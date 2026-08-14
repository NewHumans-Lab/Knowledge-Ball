import { strict as assert } from 'node:assert';
import {
  ACCURACY_GATES, challengePolicy, currentAccuracy, nextStakeTier, ordinaryVotesRequired,
  settlementEntitlements, timeoutVerdict,
} from './original-design-policy';

assert.deepEqual([0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000].map(ordinaryVotesRequired), [1, 1, 1, 2, 2, 4, 4, 8, 8, 16]);
assert.deepEqual(challengePolicy(0), { stake: 10n, scope: 'GLOBAL' });
assert.deepEqual(challengePolicy(1), { stake: 10n, scope: 'LOCAL_10' });
for (let i = 0; i < ACCURACY_GATES.length; i++) {
  assert.deepEqual(challengePolicy(2 + i * 2), { stake: 10n, accuracyGate: ACCURACY_GATES[i], scope: 'GLOBAL' });
  assert.deepEqual(challengePolicy(3 + i * 2), { stake: 10n, accuracyGate: ACCURACY_GATES[i], scope: 'LOCAL_10' });
}
assert.deepEqual(challengePolicy(32), { stake: 20n, accuracyGate: 50, scope: 'GLOBAL' });
assert.equal(nextStakeTier(90n), 100n); assert.equal(nextStakeTier(900n), 1000n); assert.equal(nextStakeTier(9000n), 10000n);
assert.deepEqual(timeoutVerdict('PENDING', 'AGREE', 0, 0), { verdict: 'CORRECT', tied: false });
assert.deepEqual(timeoutVerdict('CORRECT', 'DISAGREE', 0, 0), { verdict: 'INCORRECT', tied: false });
assert.deepEqual(timeoutVerdict('CORRECT', 'DISAGREE', 1, 0), { verdict: 'CORRECT', tied: true });

const accuracy = currentAccuracy([
  { claimVersionId: 'x', side: 'AGREE' }, { claimVersionId: 'x', side: 'AGREE' }, { claimVersionId: 'x', side: 'DISAGREE' },
  { claimVersionId: 'pending', side: 'AGREE' },
], new Map([['x', 'CORRECT'], ['pending', 'PENDING']]));
assert.deepEqual(accuracy, { attempts: 2, wins: 1, accuracy: 0.5 });
assert.equal(currentAccuracy([], new Map()).accuracy, undefined);

const entitlements = settlementEntitlements([
  { id: 'b', accountId: 'b', side: 'AGREE', stakeAtoms: 1n },
  { id: 'a', accountId: 'a', side: 'AGREE', stakeAtoms: 1n },
  { id: 'c', accountId: 'c', side: 'DISAGREE', stakeAtoms: 1n },
], 'CORRECT');
assert.deepEqual(entitlements, [
  { positionId: 'a', accountId: 'a', amountAtoms: 2n },
  { positionId: 'b', accountId: 'b', amountAtoms: 1n },
]);
assert.equal(entitlements.reduce((sum, item) => sum + item.amountAtoms, 0n), 3n);
console.log('ORIGINAL_DESIGN_V1 contract tests passed');
