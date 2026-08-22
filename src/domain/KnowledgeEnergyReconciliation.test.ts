import assert from 'node:assert/strict';
import {
  ENERGY_ATOMS_PER_UNIT,
  challengeEntitlements,
  equalStakeEntitlements,
  initialCreatorEntitlement,
  initialOrdinaryVoteEntitlements,
  reconciliationDeltaAtoms,
} from './KnowledgeEnergyReconciliation';

const E = ENERGY_ATOMS_PER_UNIT;

function payouts(entries: ReturnType<typeof equalStakeEntitlements>): Record<string, bigint> {
  return Object.fromEntries(entries.map(entry => [entry.key, entry.payoutAtoms]));
}

// V2 ordinary pool: two AGREE vs one DISAGREE. Each AGREE winner gets own
// one-energy stake + half of the losing one-energy stake.
assert.deepEqual(payouts(initialOrdinaryVoteEntitlements([
  { key:'vote:a', side:'AGREE' },
  { key:'vote:b', side:'AGREE' },
  { key:'vote:c', side:'DISAGREE' },
], 'CORRECT')), {
  'vote:a': 1_500_000n,
  'vote:b': 1_500_000n,
  'vote:c': 0n,
});

// Reversing the viewpoint deterministically reverses the same historical pool.
assert.deepEqual(payouts(initialOrdinaryVoteEntitlements([
  { key:'vote:a', side:'AGREE' },
  { key:'vote:b', side:'AGREE' },
  { key:'vote:c', side:'DISAGREE' },
], 'INCORRECT')), {
  'vote:a': 0n,
  'vote:b': 0n,
  'vote:c': 3_000_000n,
});

// Remainder atoms are deterministic by position key, not iteration order.
assert.deepEqual(payouts(equalStakeEntitlements([
  { key:'winner:z', side:'AGREE' },
  { key:'loser', side:'DISAGREE' },
  { key:'winner:a', side:'AGREE' },
  { key:'winner:m', side:'AGREE' },
], 'CORRECT', E)), {
  'loser': 0n,
  'winner:a': 1_333_334n,
  'winner:m': 1_333_333n,
  'winner:z': 1_333_333n,
});

assert.equal(initialCreatorEntitlement(true, 'CORRECT'), 2n*E);
assert.equal(initialCreatorEntitlement(true, 'INCORRECT'), 0n);
assert.equal(initialCreatorEntitlement(false, 'CORRECT'), 0n, 'legacy unfunded creator has no monetary position');

// V1 challenge: initiator is an AGREE energy position and all positions use the
// same round stake. One initiator + one AGREE voter beat one DISAGREE voter.
assert.deepEqual(payouts(challengeEntitlements(
  'initiator:u1',
  [
    { key:'vote:v1', side:'AGREE' },
    { key:'vote:v2', side:'DISAGREE' },
  ],
  'CORRECT',
  10n*E,
)), {
  'initiator:u1': 15_000_000n,
  'vote:v1': 15_000_000n,
  'vote:v2': 0n,
});

// On a flip to INCORRECT, the sole DISAGREE voter gets all three 10-energy
// positions, while the former winners' desired payout becomes zero.
assert.deepEqual(payouts(challengeEntitlements(
  'initiator:u1',
  [
    { key:'vote:v1', side:'AGREE' },
    { key:'vote:v2', side:'DISAGREE' },
  ],
  'INCORRECT',
  10n*E,
)), {
  'initiator:u1': 0n,
  'vote:v1': 0n,
  'vote:v2': 30_000_000n,
});

// No winner means no synthetic payout. The locked pool stays in SYSTEM.
assert.deepEqual(payouts(equalStakeEntitlements([
  { key:'agree-only', side:'AGREE' },
], 'INCORRECT', E)), { 'agree-only': 0n });

// Delta is always desired - already-applied. Replaying the same viewpoint event
// after its first reconciliation is therefore exactly zero.
assert.equal(reconciliationDeltaAtoms(0n, 1_500_000n), -1_500_000n);
assert.equal(reconciliationDeltaAtoms(0n, 1_500_000n, [-1_500_000n]), 0n);
assert.equal(reconciliationDeltaAtoms(3_000_000n, 0n), 3_000_000n);
assert.equal(reconciliationDeltaAtoms(1_500_000n, 0n, [3_000_000n]), -1_500_000n, 'later flip can reverse a prior reconciliation without rewriting it');

console.log('Knowledge energy reconciliation entitlement tests passed');
