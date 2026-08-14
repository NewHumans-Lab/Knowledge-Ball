import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608130002_energy_ledger.sql', 'utf8');
const cleanup = await readFile('supabase/migrations/202608140001_remove_phone_auth.sql', 'utf8');
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
console.log('Energy ledger migration architecture checks passed');
