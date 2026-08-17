import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608130002_energy_ledger.sql', 'utf8');
const cleanup = await readFile('supabase/migrations/202608140001_remove_phone_auth.sql', 'utf8');
const votes = await readFile('supabase/migrations/202608170001_pending_knowledge_votes.sql', 'utf8');
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
assert.match(votes, /transaction_type in \('REFERRAL', 'SPEND', 'TRANSFER', 'VOTE_STAKE'\)/);
assert.match(votes, /balance - stake_amount >= -10\.000000/, 'vote stake must respect the user floor');
assert.match(votes, /\(tx, user_account, -stake_amount\)/, 'vote must debit the voter ledger');
assert.match(votes, /00000000-0000-0000-0000-000000000001', stake_amount/, 'vote stake must have a balancing system entry');
assert.match(votes, /perform public\.assert_energy_conservation\(\)/, 'vote transaction must verify conservation');
assert.match(votes, /pg_advisory_xact_lock/, 'concurrent votes for one node must serialize');
assert.match(votes, /enable row level security/);
assert.match(votes, /revoke all on public\.knowledge_pending_votes from public, anon, authenticated/);
assert.doesNotMatch(votes, /grant (insert|update|delete).*knowledge_pending_votes/i, 'browser roles must not mutate votes directly');
assert.match(votes, /grant execute on function public\.get_pending_knowledge_vote\(text\), public\.cast_pending_knowledge_vote\(text,text,text\)/);
assert.match(votes, /202608170001/);
console.log('Energy ledger migration architecture checks passed');
