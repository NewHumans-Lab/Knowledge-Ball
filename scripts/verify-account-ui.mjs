import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [auth, ui, sync, migration] = await Promise.all([
  readFile('src/auth/AuthClient.ts','utf8'), readFile('src/ui/AuthUi.ts','utf8'),
  readFile('src/sync/SupabaseSyncAdapter.ts','utf8'), readFile('supabase/migrations/202608140001_remove_phone_auth.sql','utf8'),
]);

// Issue #42 removed phone/SMS/OTP as a participation gate. Optional username +
// password recovery added later must not reintroduce any of those dependencies.
for (const source of [auth, ui, sync]) assert.doesNotMatch(source, /phone|sms|otp|verified_phone|验证码/i);
assert.match(auth, /body: '\{\}'/);
assert.match(auth, /ensure_anonymous_profile/);
assert.match(sync, /append_public_knowledge_events/);
assert.doesNotMatch(sync, /requiresAccount|verified|phone|sms|otp|注册|登录/i);
assert.match(ui, /我的能量/);
assert.match(ui, /总能量/);
assert.match(ui, /准确率/);
assert.match(ui, /编辑资料/);
assert.match(ui, /用户名 \+ 密码登录/, 'recoverable account login is optional account UI, not a public-write gate');
assert.match(ui, /设置 \/ 修改用户名和密码/, 'an anonymous user must be able to upgrade the same immutable user_id');
assert.doesNotMatch(ui, /write_entry|刷新余额/i);
for (const item of ['drop function public.register_verified_phone','legacy_phone_registration_registry','legacy_phone_referrals','ensure_anonymous_profile','0.000000']) {
  assert.ok(migration.includes(item), `missing cleanup: ${item}`);
}
console.log('Anonymous participation remains phone-free while optional username recovery is allowed');