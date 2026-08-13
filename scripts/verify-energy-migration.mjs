import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608130002_energy_ledger.sql', 'utf8');
for (const table of ['phone_registration_registry', 'knowledge_ball_profiles', 'energy_accounts', 'energy_transactions', 'energy_ledger_entries', 'referrals']) {
  assert.match(sql, new RegExp(`create table public\\.${table}`), `missing ${table}`);
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`), `RLS missing for ${table}`);
}
assert.match(sql, /exactly_one_system_account/);
assert.match(sql, /one_active_account_per_phone/);
assert.match(sql, /balance >= -10/);
assert.match(sql, /having sum\(amount\) <> 0/);
assert.match(sql, /global energy conservation violated/);
assert.match(sql, /materialized balance differs from ledger/);
assert.match(sql, /auth\.jwt\(\)->>'phone'/);
assert.match(sql, /security definer/g);
assert.doesNotMatch(sql, /grant (insert|update|delete).*energy_/i);
console.log('Energy ledger migration architecture checks passed');
