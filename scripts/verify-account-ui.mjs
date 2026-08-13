import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [auth, ui, sql] = await Promise.all([
  readFile('src/auth/AuthClient.ts', 'utf8'),
  readFile('src/ui/AuthUi.ts', 'utf8'),
  readFile('supabase/migrations/202608130003_account_profiles_energy_precision.sql', 'utf8'),
]);

assert.match(auth, /\/auth\/v1\/signup/);
assert.match(auth, /\/auth\/v1\/verify/);
assert.match(auth, /async verifySms[\s\S]*\/auth\/v1\/verify[\s\S]*saveSession\(response\)[\s\S]*ensureProfile\(normalizedPhone\)/);
assert.match(auth, /Phone Provider、配置短信服务商并开启 OTP 验证/);
assert.match(auth, /get_my_account/);
assert.match(auth, /update_my_profile/);
assert.match(auth, /function exactEnergy/);
assert.match(ui, /我的能量/);
assert.match(ui, /总能量/);
assert.match(ui, /<span>准确率<\/span>/);
assert.match(ui, /编辑资料/);
assert.doesNotMatch(ui, /刷新余额|kbRefreshBalances|user_id|account_no/);
assert.match(ui, /compactEnergy\(accountCache\.myBalance\)/);
for (const invariant of ['account_no', 'permanent identity is immutable', 'numeric(30,6)', 'amount <> round(amount, 6)', 'auth.uid()', 'assert_energy_conservation() from public, anon, authenticated']) {
  assert.ok(sql.includes(invariant), `missing account invariant: ${invariant}`);
}
assert.doesNotMatch(sql, /phone_normalized.*jsonb_build_object/);
console.log('Issue #38 account/auth/profile/energy UI checks passed');
