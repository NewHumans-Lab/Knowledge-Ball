import { strict as assert } from 'node:assert';
import {
  POLICY_VERSION,
  ROUND_DURATION_MS,
  insufficientSupportTimeoutDecision,
  ordinaryVotesRequired,
} from './original-design-policy';

assert.equal(POLICY_VERSION, 'ORIGINAL_DESIGN_V2');
assert.equal(ROUND_DURATION_MS, 30 * 24 * 60 * 60 * 1_000, 'first-round window stays exactly 30 days');
assert.deepEqual([0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000].map(ordinaryVotesRequired), [1, 1, 1, 2, 2, 4, 4, 8, 8, 16]);

assert.deepEqual(
  insufficientSupportTimeoutDecision(0, 0, 2),
  { verdict: 'INCORRECT', tied: false, ordinaryWinner: 'SYSTEM' },
  'a completely ignored claim must fail and leave its forfeited energy in the system account',
);
assert.deepEqual(
  insufficientSupportTimeoutDecision(1, 0, 2),
  { verdict: 'INCORRECT', tied: false, ordinaryWinner: 'SYSTEM' },
  'support below threshold cannot promote a claim merely because nobody opposed it',
);
assert.deepEqual(
  insufficientSupportTimeoutDecision(1, 1, 2),
  { verdict: 'INCORRECT', tied: false, ordinaryWinner: 'DISAGREE' },
  'when opposition exists it is the winning ordinary side of an insufficient-support timeout',
);

assert.throws(() => insufficientSupportTimeoutDecision(2, 0, 2), /only applies before either side reaches threshold/);
assert.throws(() => insufficientSupportTimeoutDecision(0, 2, 2), /only applies before either side reaches threshold/);
assert.throws(() => insufficientSupportTimeoutDecision(0, 0, 0), /requiredVotes is invalid/);

console.log('ORIGINAL_DESIGN_V2 insufficient-support timeout tests passed');
