import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile('supabase/migrations/202608180005_total_energy_positive_pool.sql', 'utf8');

assert.match(sql, /create or replace function public\.current_total_energy\(\) returns numeric\(30,6\)/,
  'total energy must be an exact six-decimal database-derived value');
assert.match(sql, /sum\(case when balance > 0\.000000 then balance else 0\.000000 end\)/,
  's must equal the sum of all positive account balances');
assert.doesNotMatch(sql, /current_total_energy[\s\S]*account_type\s*=\s*'USER'/,
  'SYSTEM must participate in the same positive/negative energy pool as every user account');
assert.match(sql, /'total_energy', public\.current_total_energy\(\)::text/,
  'every account response must expose the same global s value');
assert.match(sql, /revoke all on function public\.current_total_energy\(\) from public, anon, authenticated/,
  'the derived accounting helper must remain internal rather than becoming a browser RPC');
assert.match(sql, /grant execute on function public\.get_my_account\(\) to authenticated/,
  'the existing account UI API must remain callable after replacement');

function positivePool(values) {
  return values.reduce((sum, value) => sum + (value > 0n ? value : 0n), 0n);
}
function negativeMagnitude(values) {
  return -values.reduce((sum, value) => sum + (value < 0n ? value : 0n), 0n);
}
function conservation(values) {
  return values.reduce((sum, value) => sum + value, 0n);
}

const examples = [
  [0n, 0n, 0n],
  [-10_000000n, 4_000000n, 6_000000n],
  [8_250000n, -3_250000n, -5_000000n],
  [-12_000001n, 10_000000n, 2_000001n],
];

for (const balances of examples) {
  assert.equal(conservation(balances), 0n, 'fixture must obey energy conservation');
  assert.equal(positivePool(balances), negativeMagnitude(balances),
    'under conservation, positive balances must equal the magnitude of negative balances');
}
assert.equal(positivePool([-10_000000n, 4_000000n, 6_000000n]), 10_000000n,
  'a negative SYSTEM balance plus positive users must report s=10');
assert.equal(positivePool([8_250000n, -3_250000n, -5_000000n]), 8_250000n,
  'a positive SYSTEM balance must itself count toward s');

console.log('Global total-energy positive-pool semantics passed');
