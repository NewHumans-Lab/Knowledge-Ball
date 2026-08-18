import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608130002_energy_ledger.sql', 'utf8');
const cleanup = await readFile('supabase/migrations/202608140001_remove_phone_auth.sql', 'utf8');
const votes = await readFile('supabase/migrations/202608170001_pending_knowledge_votes.sql', 'utf8');
const rounds = await readFile('supabase/migrations/202608180001_pending_vote_round_settlement.sql', 'utf8');
const poolCorrection = await readFile('supabase/migrations/202608180002_pending_vote_settlement_pool_correction.sql', 'utf8');
const readySweep = await readFile('supabase/migrations/202608180003_pending_vote_ready_sweep.sql', 'utf8');
const v2 = await readFile('supabase/migrations/202608180004_legacy_late_vote_refunds.sql', 'utf8');

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

// PR #66 scaffolding remains ordered and replayable, but browser access is held
// closed until the final V2 migration installs the actual hosted policy.
assert.match(rounds, /create table public\.knowledge_pending_vote_rounds/, 'pending claims need a durable snapshotted verification round');
assert.match(rounds, /eligible_user_snapshot bigint not null/, 'round must freeze eligible-user count rather than using a future live count');
assert.match(rounds, /required_votes integer not null/, 'round must freeze its threshold');
assert.match(rounds, /deadline = opened_at \+ interval '720 hours'/, 'first-round deadline must stay exactly 720 hours');
assert.match(rounds, /legacy_unfunded boolean not null default false/, 'old pending claims need an explicit no-retrocharge compatibility marker');
assert.match(rounds, /alter table public\.knowledge_pending_votes add column round_id uuid/, 'existing ordinary votes must attach to their durable round');
assert.match(rounds, /transaction_type in \('REFERRAL', 'SPEND', 'TRANSFER', 'VOTE_STAKE', 'CLAIM_STAKE', 'VOTE_SETTLEMENT'\)/, 'creator stake and settlement must be auditable ledger transaction types');
assert.match(rounds, /fund_new_pending_vote_round/, 'new KnowledgeAdded events must atomically create and fund their verification round');
assert.match(rounds, /balance-stake_amount >= -10\.000000/, 'creator stake must respect the same user balance floor');
assert.match(rounds, /KnowledgeVerdictFinalized/, 'final verdict must enter the public server event stream');
assert.match(rounds, /protocol verdict events are server-only/, 'browser event batches must not forge truth-protocol verdicts');
assert.match(rounds, /event_type='KnowledgeVerdictFinalized'/, 'pending detection must stop once the server verdict exists');
assert.match(rounds, /revoke all on public\.knowledge_pending_vote_rounds from public, anon, authenticated/, 'browser roles must not read or mutate raw round rows directly');
assert.doesNotMatch(rounds, /grant (insert|update|delete).*knowledge_pending_vote_rounds/i, 'round writes must remain RPC-only');

assert.match(poolCorrection, /offset greatest\(round_row\.required_votes-1,0\) limit 1/g, 'historical repair must reconstruct the first side that actually reached threshold');
assert.match(poolCorrection, /losing_atoms := disagree_count::bigint \* 1000000/, 'ordinary AGREE winners split only ordinary DISAGREE stakes');
assert.match(poolCorrection, /losing_atoms := agree_count::bigint \* 1000000/, 'ordinary DISAGREE winners split only ordinary AGREE stakes');
assert.doesNotMatch(poolCorrection, /losing_atoms := .*funded/, 'creator/system wager must never contaminate the ordinary voter pool');
assert.match(poolCorrection, /creator_payout := 2\.000000/, 'winning creator gets their one-energy stake back plus exactly one system energy');

assert.match(readySweep, /revoke execute on function public\.get_pending_knowledge_vote\(text\) from authenticated/, 'browser tally reads must stay gated while the transitional V1 finalizer exists');
assert.match(readySweep, /revoke execute on function public\.cast_pending_knowledge_vote\(text,text,text\) from authenticated/, 'browser votes must stay gated while the transitional V1 finalizer exists');
assert.doesNotMatch(readySweep, /grant execute on function public\.settle_expired_pending_knowledge_votes/, 'transitional V1 sweep must not be exposed before V2 installation');

// ORIGINAL_DESIGN_V2: a claim earns visibility by reaching threshold within 30
// days. Time alone can never turn silence into correctness.
assert.match(v2, /alter column policy_version set default 'ORIGINAL_DESIGN_V2'/, 'new first rounds must use the V2 policy');
assert.match(v2, /set policy_version='ORIGINAL_DESIGN_V2'\s*where verdict='PENDING'/, 'still-unpublished pending rounds must be promoted to V2 before hosted settlement begins');
assert.match(v2, /deadline = opened_at \+ interval '720 hours'|opened\+interval '720 hours'/, 'V2 must retain the exact 30-day window');
assert.match(v2, /decided_verdict := 'INCORRECT';\s*decided_reason := 'TIMEOUT'/, 'V2 insufficient support must always fail at timeout');
assert.doesNotMatch(v2, /agree_count \+ case when round_row\.initiator_side.*then 'CORRECT'/s, 'V1 timeout-majority promotion must not survive inside V2');
assert.match(v2, /winner_count := disagree_count::bigint/, 'INCORRECT ordinary settlement may reward only actual DISAGREE voters');
assert.match(v2, /if winner_count>0 then[\s\S]*share_atoms := losing_atoms\/winner_count/, 'zero-opposition timeout must create no synthetic user winner');
assert.match(v2, /all failed AGREE stakes therefore remain in SYSTEM/, 'no-opposition timeout must explicitly retain failed AGREE stakes in the system account');
assert.match(v2, /funded and decided_verdict='CORRECT'/, 'creator/system wager pays the creator only on a correct verdict');
assert.match(v2, /creator stake stays in SYSTEM/, 'failed creator stake must remain in the system account');

// Creator cannot count twice: creator/system wager is their only first-round
// position. Historical creator ballots are audit-preserved and refunded.
assert.match(v2, /settlement_status in \('ACTIVE','VOID_LATE','VOID_CREATOR'\)/, 'historical invalid votes need explicit audit states');
assert.match(v2, /voter_id=round_row\.initiator_id[\s\S]*settlement_status='ACTIVE'/, 'historical creator self-votes must be excluded from verdict math');
assert.match(v2, /claim creator cannot cast an ordinary vote on the same first-round claim/, 'new creator self-votes must be rejected by the authoritative RPC');
assert.match(v2, /where v\.round_id=round_row\.id and v\.settlement_status<>'ACTIVE'[\s\S]*refunded_transaction_id is null/, 'invalid historical ballots must be refundable and auditable');
assert.match(v2, /balance=balance\+void_vote\.stake/, 'invalid historical ballot refunds must return the exact recorded stake');
assert.match(v2, /set refunded_transaction_id=tx/, 'refunds must be linked to the settlement transaction');

assert.match(v2, /created_at>round_row\.deadline/, 'votes arriving after the exact deadline must not affect V2 verdicts');
assert.match(v2, /created_at>closure_at.*id::text>closure_id::text/s, 'votes after an earlier threshold closure must be voided by exact chronology');
assert.match(v2, /settlement_status='ACTIVE'/g, 'verdict counts and winner pools must use only valid ballots');
assert.match(v2, /perform public\.assert_energy_conservation\(\)/, 'V2 settlement must end with a conservation assertion');
assert.match(v2, /grant execute on function public\.get_pending_knowledge_vote\(text\),[\s\S]*public\.cast_pending_knowledge_vote\(text,text,text\),[\s\S]*public\.settle_expired_pending_knowledge_votes\(integer\)[\s\S]*to authenticated/, 'browser voting/tally/sweep may be enabled only after V2 is installed');
assert.match(v2, /where verdict='PENDING' and legacy_unfunded/, 'historical repair must run only after V2 and refund semantics are installed');
assert.match(v2, /202608180004/, 'hosted schema version must advance through V2 adjudication');

console.log('Energy ledger and ORIGINAL_DESIGN_V2 pending-vote architecture checks passed');
