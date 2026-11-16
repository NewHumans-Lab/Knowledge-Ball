import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  'supabase/migrations/202611160001_system_counter_vote_rewards.sql',
  'utf8',
);
const priorReconciliation = await readFile(
  'supabase/migrations/202608220003_viewpoint_energy_reconciliation.sql',
  'utf8',
);
const priorCascade = await readFile(
  'supabase/migrations/202608220009_cascade_revalidation_hardening.sql',
  'utf8',
);

// Both voting data paths persist an immutable 1E counter-position per new round.
assert.match(migration, /knowledge_pending_vote_rounds[\s\S]*system_counter_stake numeric\(30,6\) not null default 0\.000000/);
assert.match(migration, /knowledge_revalidation_rounds[\s\S]*system_counter_stake numeric\(30,6\) not null default 0\.000000/);
assert.match(migration, /system_counter_side in \('AGREE','DISAGREE'\)/);
assert.match(migration, /create trigger apply_system_counter_vote_position[\s\S]*after insert on public\.energy_transactions/i);
assert.match(migration, /'PENDING_VOTE_SETTLEMENT','CASCADE_REVALIDATION_SETTLEMENT'/);
assert.match(migration, /'KNOWLEDGE_REVALIDATION_SETTLEMENT'/);
assert.match(migration, /set system_counter_stake=1\.000000,system_counter_side=v_counter_side/g);

// The synthetic position is assigned after the verdict and never enters ballot
// counts, threshold calculation, or the visible vote totals.
assert.match(migration, /v_counter_side:=case when v_winning_side='AGREE' then 'DISAGREE' else 'AGREE' end/g);
assert.match(priorCascade, /count\(\) filter\(where side='AGREE'\)/);
assert.match(priorCascade, /count\(\) filter\(where side='DISAGREE'\)/);
assert.doesNotMatch(migration, /insert into public\.knowledge_pending_votes/i);
assert.doesNotMatch(migration, /insert into private\.knowledge_revalidation_votes/i);

// The extra 1E is merged before rounding, not separately rounded. It must be
// added to the original human losing atoms and apportioned with largest remainder.
assert.match(migration, /v_combined_share_atoms:=\(v_human_losing_atoms\+1000000\)\/v_human_winner_count/);
assert.match(migration, /v_combined_remainder_atoms:=\(v_human_losing_atoms\+1000000\)%v_human_winner_count/);
assert.match(migration, /v_paid_atoms<>1000000/);
assert.match(migration, /balance=balance-1\.000000/);
assert.match(migration, /values\(new\.id,v_system_account,-1\.000000\)/);

// Reversal replays the counter-position as either a losing 1E or an additional
// winner, while returning only USER positions. Existing reconciliation already
// books the opposite aggregate delta to SYSTEM and permits negative balances.
assert.match(migration, /r\.system_counter_side/);
assert.match(migration, /r\.system_counter_stake\*1000000/);
assert.match(migration, /:system:counter/g);
assert.match(priorReconciliation, /v_delta:=\(v_position\.desired_payout-v_previous_applied\)/);
assert.match(priorReconciliation, /set balance=a\.balance\+v_delta/);
assert.match(priorReconciliation, /set balance=a\.balance-v_total_user_delta/);
assert.match(priorReconciliation, /perform public\.assert_energy_conservation\(\)/);
assert.doesNotMatch(migration, /update public\.energy_transactions|delete from public\.energy_transactions/i);
assert.doesNotMatch(migration, /update public\.energy_ledger_entries|delete from public\.energy_ledger_entries/i);
assert.match(migration, /select '202611160001'::text/);

// Deterministic economic examples in exact 1e-6 atoms.
// Initial: Alice wins over Bob; the system joins Bob and contributes 1E.
const settle = (positions, winningSide) => {
  const winners = positions
    .filter((position) => position.side === winningSide)
    .sort((a, b) => a.key.localeCompare(b.key));
  const losingAtoms = positions
    .filter((position) => position.side !== winningSide)
    .reduce((sum, position) => sum + position.stakeAtoms, 0n);
  if (winners.length === 0) return new Map();
  const share = losingAtoms / BigInt(winners.length);
  const remainder = losingAtoms % BigInt(winners.length);
  return new Map(winners.map((position, index) => [
    position.key,
    position.stakeAtoms + share + (BigInt(index) < remainder ? 1n : 0n),
  ]));
};
const E = 1_000_000n;
const originalPositions = [
  { key: 'vote:alice', side: 'AGREE', stakeAtoms: E },
  { key: 'vote:bob', side: 'DISAGREE', stakeAtoms: E },
  { key: 'system:counter', side: 'DISAGREE', stakeAtoms: E },
];
const firstResult = settle(originalPositions, 'AGREE');
assert.equal(firstResult.get('vote:alice'), 3n * E);
assert.equal(firstResult.has('vote:bob'), false);
assert.equal(firstResult.has('system:counter'), false);
assert.equal([...firstResult.values()].reduce((a, b) => a + b, 0n), 3n * E);

// Reversal: Bob and the system counter-position win; each receives 1.5E.
const reversedResult = settle(originalPositions, 'DISAGREE');
assert.equal(reversedResult.get('vote:bob'), 1_500_000n);
assert.equal(reversedResult.get('system:counter'), 1_500_000n);
assert.equal([...reversedResult.values()].reduce((a, b) => a + b, 0n), 3n * E);

// One-sided but correct vote: the system supplies the missing opposing 1E.
const oneSided = settle([
  { key: 'vote:only-human', side: 'AGREE', stakeAtoms: E },
  { key: 'system:counter', side: 'DISAGREE', stakeAtoms: E },
], 'AGREE');
assert.equal(oneSided.get('vote:only-human'), 2n * E);

// No human winner at timeout: there is no immediate recipient, but the stored
// system side remains available for the later historical recalculation.
const noHumanWinner = settle([
  { key: 'vote:agree-only', side: 'AGREE', stakeAtoms: E },
  { key: 'system:counter', side: 'AGREE', stakeAtoms: E },
], 'DISAGREE');
assert.equal(noHumanWinner.size, 0);

// Repeated flips return to the original allocation, with no compounding.
const flippedBack = settle(originalPositions, 'AGREE');
assert.deepEqual([...flippedBack.entries()], [...firstResult.entries()]);

console.log('System counter-vote, reversal, largest-remainder and conservation checks passed');
