import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608130002_energy_ledger.sql', 'utf8');
const cleanup = await readFile('supabase/migrations/202608140001_remove_phone_auth.sql', 'utf8');
const votes = await readFile('supabase/migrations/202608170001_pending_knowledge_votes.sql', 'utf8');
const rounds = await readFile('supabase/migrations/202608180001_pending_vote_round_settlement.sql', 'utf8');
const poolCorrection = await readFile('supabase/migrations/202608180002_pending_vote_settlement_pool_correction.sql', 'utf8');
const readySweep = await readFile('supabase/migrations/202608180003_pending_vote_ready_sweep.sql', 'utf8');
for (const table of ['phone_registration_registry', 'knowledge_ball_profiles', 'energy_accounts', 'energy_transactions', 'energy_ledger_entries', 'referrals']) {
  assert.match(sql, new RegExp(`create table public\\.${table}`), `missing ${table}`);
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `RLS missing for ${table}`);
}
assert.match(sql, /exactly_one_system_account/);
assert.match(sql, /balance >= -10/);
assert.match(sql, /having sum\(amount\) <> 0/);
assert.match(sql, /global energy conservation violated/);
assert.match(sql, /materialized balance differs from ledger/);
assert.match(sql, /security definer/g);
assert.doesNotMatch(sql, /grant (insert|update|delete).*energy_/i);
assert.match(cleanup, /drop function public\.register_verified_phone/);
assert.match(cleanup, /legacy_phone_referrals/);

assert.match(votes, /create table public\.knowledge_pending_votes/);
assert.match(votes, /unique\(node_id, voter_id\)/, 'one account must vote at most once per pending node');
assert.match(votes, /side in \('AGREE', 'DISAGREE'\)/);
assert.match(votes, /stake = 1\.000000/, 'ordinary vote stake must stay exactly one energy');
assert.match(votes, /balance - stake_amount >= -10\.000000/, 'vote stake must respect the user floor');
assert.match(votes, /\(tx, user_account, -stake_amount\)/, 'vote must debit the voter ledger');
assert.match(votes, /00000000-0000-0000-0000-000000000001', stake_amount/, 'vote stake must have a balancing system entry');
assert.match(votes, /perform public\.assert_energy_conservation\(\)/, 'vote transaction must verify conservation');
assert.match(votes, /pg_advisory_xact_lock/, 'concurrent votes for one node must serialize');
assert.match(votes, /enable row level security/);
assert.match(votes, /revoke all on public\.knowledge_pending_votes from public, anon, authenticated/);
assert.doesNotMatch(votes, /grant (insert|update|delete).*knowledge_pending_votes/i, 'browser roles must not mutate votes directly');

assert.match(rounds, /create table public\.knowledge_pending_vote_rounds/, 'pending claims need a durable snapshotted verification round');
assert.match(rounds, /policy_version text not null default 'ORIGINAL_DESIGN_V1'/, 'round must freeze the immutable policy version');
assert.match(rounds, /eligible_user_snapshot bigint not null/, 'round must freeze eligible-user count rather than using a future live count');
assert.match(rounds, /required_votes integer not null/, 'round must freeze its threshold');
assert.match(rounds, /deadline = opened_at \+ interval '720 hours'/, 'V1 first-round deadline must stay exactly 720 hours');
assert.match(rounds, /legacy_unfunded boolean not null default false/, 'old pending claims need an explicit no-retrocharge compatibility marker');
assert.match(rounds, /alter table public\.knowledge_pending_votes add column round_id uuid/, 'existing ordinary votes must attach to their durable round');
assert.match(rounds, /transaction_type in \('REFERRAL', 'SPEND', 'TRANSFER', 'VOTE_STAKE', 'CLAIM_STAKE', 'VOTE_SETTLEMENT'\)/, 'creator stake and settlement must be auditable ledger transaction types');
assert.match(rounds, /fund_new_pending_vote_round/, 'new KnowledgeAdded events must atomically create and fund their verification round');
assert.match(rounds, /balance-stake_amount >= -10\.000000/, 'creator stake must respect the same user balance floor');
assert.match(rounds, /perform public\.finalize_pending_vote_round\(vote_round_id\)/g, 'cast RPC must evaluate the round inside the serialized vote transaction');
assert.match(rounds, /KnowledgeVerdictFinalized/, 'final verdict must enter the canonical public event stream');
assert.match(rounds, /protocol verdict events are server-only/, 'browser event batches must not forge truth-protocol verdicts');
assert.match(rounds, /event_type='KnowledgeVerdictFinalized'/, 'pending detection must stop once the server verdict exists');
assert.match(rounds, /revoke all on public\.knowledge_pending_vote_rounds from public, anon, authenticated/, 'browser roles must not read or mutate raw round rows directly');
assert.doesNotMatch(rounds, /grant (insert|update|delete).*knowledge_pending_vote_rounds/i, 'round writes must remain RPC-only');

assert.match(poolCorrection, /offset greatest\(round_row\.required_votes-1,0\) limit 1/g, 'historical repair must reconstruct the first side that actually reached threshold');
assert.match(poolCorrection, /losing_atoms := disagree_count::bigint \* 1000000/, 'ordinary AGREE winners split only ordinary DISAGREE stakes');
assert.match(poolCorrection, /losing_atoms := agree_count::bigint \* 1000000/, 'ordinary DISAGREE winners split only ordinary AGREE stakes');
assert.doesNotMatch(poolCorrection, /losing_atoms := .*funded/, 'creator/system wager must never contaminate the ordinary voter pool');
assert.match(poolCorrection, /creator_payout := 2\.000000/, 'winning creator gets their one-energy stake back plus exactly one system energy');
assert.match(poolCorrection, /funded and decided_verdict='CORRECT'/, 'creator payout only occurs on a funded correct verdict');
assert.match(poolCorrection, /perform public\.assert_energy_conservation\(\)/, 'final settlement must end with a conservation assertion');

assert.match(readySweep, /r\.deadline<=now\(\)/, 'readiness sweep must cover V1 timeout');
assert.match(readySweep, /v\.side='AGREE'.*>= r\.required_votes/s, 'readiness sweep must cover reached AGREE threshold');
assert.match(readySweep, /v\.side='DISAGREE'.*>= r\.required_votes/s, 'readiness sweep must cover reached DISAGREE threshold');
assert.match(readySweep, /where verdict='PENDING' and legacy_unfunded/, 'migration must immediately repair historical threshold-ready rounds');
assert.match(readySweep, /202608180003/, 'schema version must advance through the completed adjudication chain');

console.log('Energy ledger and pending-vote settlement architecture checks passed');
