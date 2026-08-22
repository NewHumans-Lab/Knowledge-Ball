import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reconciliation = await readFile('supabase/migrations/202608220003_viewpoint_energy_reconciliation.sql', 'utf8');
const debitHardening = await readFile('supabase/migrations/202608140002_issue45_hardening.sql', 'utf8');
const firstRoundV2 = await readFile('supabase/migrations/202608180004_legacy_late_vote_refunds.sql', 'utf8');
const revalidationV1 = await readFile('supabase/migrations/202608220001_lineage_server_projection_revalidation_v1.sql', 'utf8');

// Small test-only oracle for the frozen equal-stake pool. Do not add a second
// production/domain implementation: runtime authority remains the SQL migration.
const E = 1_000_000n;
function equalStakePayouts(positions, winningSide, stakeAtoms) {
  const winners = positions.filter(position => position.side === winningSide)
    .sort((a, b) => a.key.localeCompare(b.key));
  const winnerCount = BigInt(winners.length);
  const loserCount = BigInt(positions.length - winners.length);
  const share = winnerCount === 0n ? 0n : loserCount * stakeAtoms / winnerCount;
  const remainder = winnerCount === 0n ? 0n : loserCount * stakeAtoms % winnerCount;
  const payouts = Object.fromEntries(positions.map(position => [position.key, 0n]));
  winners.forEach((winner, index) => {
    payouts[winner.key] = stakeAtoms + share + (BigInt(index) < remainder ? 1n : 0n);
  });
  return payouts;
}

assert.deepEqual(equalStakePayouts([
  { key:'vote:a', side:'AGREE' }, { key:'vote:b', side:'AGREE' }, { key:'vote:c', side:'DISAGREE' },
], 'AGREE', E), { 'vote:a':1_500_000n, 'vote:b':1_500_000n, 'vote:c':0n });
assert.deepEqual(equalStakePayouts([
  { key:'vote:a', side:'AGREE' }, { key:'vote:b', side:'AGREE' }, { key:'vote:c', side:'DISAGREE' },
], 'DISAGREE', E), { 'vote:a':0n, 'vote:b':0n, 'vote:c':3_000_000n });
assert.deepEqual(equalStakePayouts([
  { key:'winner:z', side:'AGREE' }, { key:'loser', side:'DISAGREE' },
  { key:'winner:a', side:'AGREE' }, { key:'winner:m', side:'AGREE' },
], 'AGREE', E), {
  'winner:z':1_333_333n, loser:0n, 'winner:a':1_333_334n, 'winner:m':1_333_333n,
}, 'remainder atoms must be deterministic by sorted position key');
assert.deepEqual(equalStakePayouts([
  { key:'initiator:u1', side:'AGREE' }, { key:'vote:v1', side:'AGREE' }, { key:'vote:v2', side:'DISAGREE' },
], 'AGREE', 10n*E), { 'initiator:u1':15_000_000n, 'vote:v1':15_000_000n, 'vote:v2':0n });
assert.deepEqual(equalStakePayouts([
  { key:'initiator:u1', side:'AGREE' }, { key:'vote:v1', side:'AGREE' }, { key:'vote:v2', side:'DISAGREE' },
], 'DISAGREE', 10n*E), { 'initiator:u1':0n, 'vote:v1':0n, 'vote:v2':30_000_000n });
const delta = (desired, original, prior = []) => desired - (original + prior.reduce((sum, item) => sum + item, 0n));
assert.equal(delta(0n, 1_500_000n), -1_500_000n);
assert.equal(delta(0n, 1_500_000n, [-1_500_000n]), 0n, 'same flip replay must be economically idempotent');
assert.equal(delta(1_500_000n, 0n, [3_000_000n]), -1_500_000n, 'later viewpoint flip must reverse earlier appended corrections');

// Module boundary: append-only economic reconciliation only.
assert.match(reconciliation, /'RECONCILIATION'/, 'module 5 needs a dedicated auditable transaction type');
assert.match(reconciliation, /create table private\.knowledge_viewpoint_reconciliations/);
assert.match(reconciliation, /create table private\.knowledge_reconciliation_position_deltas/);
assert.match(reconciliation, /enable row level security/g);
assert.match(reconciliation, /revoke all on private\.knowledge_viewpoint_reconciliations from public, anon, authenticated/);
assert.match(reconciliation, /revoke all on private\.knowledge_reconciliation_position_deltas from public, anon, authenticated/);
assert.doesNotMatch(reconciliation, /update\s+public\.energy_transactions/i, 'old transaction history must never be rewritten');
assert.doesNotMatch(reconciliation, /delete\s+from\s+public\.energy_transactions/i, 'old transaction history must never be deleted');
assert.doesNotMatch(reconciliation, /update\s+public\.energy_ledger_entries/i, 'old ledger history must never be rewritten');
assert.doesNotMatch(reconciliation, /delete\s+from\s+public\.energy_ledger_entries/i, 'old ledger history must never be deleted');

// Exact entitlement replay: INITIAL V2 keeps creator/system wager separate from
// the one-energy ordinary voter pool; V1 uses the frozen round stake everywhere.
assert.match(reconciliation, /initial_round_position_entitlements/);
assert.match(reconciliation, /1000000::bigint/);
assert.match(reconciliation, /case when p_desired_verdict='CORRECT' then 2\.000000 else 0\.000000 end/,
  'funded V2 creator entitlement must remain stake return + exactly one system energy');
assert.match(reconciliation, /where not r\.legacy_unfunded\s+and r\.creator_stake_transaction_id is not null/,
  'legacy unfunded claims must never gain a retroactive creator position');
assert.match(reconciliation, /revalidation_round_position_entitlements/);
assert.match(reconciliation, /\(select stake from r\) as stake/,
  'V1 entitlement must consume the frozen round stake rather than inventing a new stake');
assert.match(reconciliation, /revalidation:.*:initiator:/s,
  'V1 initiator must remain an AGREE energy position');

// Delta-only correction and repeat safety.
assert.match(reconciliation, /v_previous_applied:=\(v_position\.original_payout\+v_prior_delta\)/);
assert.match(reconciliation, /v_delta:=\(v_position\.desired_payout-v_previous_applied\)/);
assert.match(reconciliation, /coalesce\(sum\(d\.delta\),0\.000000\)/,
  'later flips must account for all previously appended reconciliation deltas');
assert.match(reconciliation, /primary key\(viewpoint_event_id,position_key\)/);
assert.match(reconciliation, /on conflict\(viewpoint_event_id\) do nothing/);
assert.match(reconciliation, /get diagnostics v_claimed_rows = row_count/);
assert.match(reconciliation, /viewpoint-reconciliation:'\|\|p_viewpoint_event_id/);
assert.match(reconciliation, /perform public\.assert_energy_conservation\(\)/);

// Only whole viewpoint flips trigger historical resettlement. Same-side
// optimization/history reactivation must not reopen old economics.
assert.match(reconciliation, /v_proposal='opposition'/);
assert.match(reconciliation, /v_role_at_start='opposition'/);
assert.doesNotMatch(reconciliation, /v_proposal='optimization'/);
assert.doesNotMatch(reconciliation, /v_role_at_start='history'/);
assert.match(reconciliation, /new\.envelope#>>'\{payload,verdict\}'='CORRECT'/g);
assert.match(reconciliation, /zz_reconcile_knowledge_viewpoint_flip/,
  'reconciliation must observe module-4 lineage role swaps, not race them');

// Lock ordering: USER accounts are locked in the same user_id ordering used by
// transfer hardening, SYSTEM is locked last.
assert.match(reconciliation, /order by a\.user_id\s+for update of a/);
const systemLock = reconciliation.indexOf('where a.id=v_system_account for update');
const userLock = reconciliation.indexOf('order by a.user_id');
assert.ok(userLock >= 0 && systemLock > userLock, 'SYSTEM lock must occur after deterministic USER locks');

// Reconciliation can claw back a historical reward below -10, but it must not
// accidentally relax any user-controlled debit. Latest voluntary debit RPCs
// continue to enforce the original floor themselves.
assert.match(reconciliation, /drop constraint if exists energy_account_floor/,
  'storage floor is deliberately replaced only so server reconciliation cannot be blocked by prior spending');
assert.match(reconciliation, /energy_account_identity/,
  'USER/SYSTEM identity invariant must remain at storage level');
assert.equal((debitHardening.match(/balance - exact_amount >= -10\.000000/g) ?? []).length, 2,
  'latest spend and transfer RPCs must both retain -10 guards');
assert.match(firstRoundV2, /balance=balance-stake_amount[\s\S]*balance-stake_amount>=-10\.000000/,
  'first-round vote stake must retain -10 guard');
assert.match(firstRoundV2, /balance=balance-stake_amount[\s\S]*where id=user_account and balance-stake_amount>=-10\.000000/,
  'first-round creator stake path must retain -10 guard');
assert.match(revalidationV1, /balance=balance-policy\.stake[\s\S]*balance-policy\.stake>=-10\.000000/,
  'V1 challenge initiation must retain -10 guard');
assert.match(revalidationV1, /balance=balance-r\.stake[\s\S]*balance-r\.stake>=-10\.000000/,
  'V1 ordinary challenge vote must retain -10 guard');

// The ambiguous self-comparison that existed in the first draft would update
// every reconciliation audit row. Keep parameter/column names explicitly scoped.
assert.doesNotMatch(reconciliation, /where\s+viewpoint_event_id\s*=\s*viewpoint_event_id/i);
assert.match(reconciliation, /where r\.viewpoint_event_id=p_viewpoint_event_id/);
assert.match(reconciliation, /select '202608220003'::text/);

console.log('Knowledge Lineage V3 module 5 reconciliation architecture and math checks passed');
