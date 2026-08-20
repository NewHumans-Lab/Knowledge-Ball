import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [auth, ui, sync, migration, profileGate] = await Promise.all([
  readFile('src/auth/AuthClient.ts','utf8'),
  readFile('src/ui/AuthUi.ts','utf8'),
  readFile('src/sync/SupabaseSyncAdapter.ts','utf8'),
  readFile('supabase/migrations/202608140001_remove_phone_auth.sql','utf8'),
  readFile('supabase/migrations/202608200003_profile_edit_requires_account.sql','utf8'),
]);

// Public viewing/participation remains phone-free. Registration is only required
// for editing personal profile fields, not for reading public knowledge.
for (const source of [auth, ui, sync]) assert.doesNotMatch(source, /phone|sms|otp|verified_phone|验证码/i);
assert.match(auth, /body: '\{\}'/);
assert.match(auth, /ensure_anonymous_profile/);
assert.match(sync, /append_public_knowledge_events/);
assert.doesNotMatch(sync, /requiresAccount|verified|phone|sms|otp|注册|登录/i);

assert.match(ui, /我的能量/);
assert.match(ui, /总能量/);
assert.match(ui, /准确率/);
assert.match(ui, /id="kbAuthEntry"[^>]*>注册 \/ 登录</,
  'account page must expose one combined registration/login entry');
assert.doesNotMatch(ui, /kbClaimLogin|kbLoginExisting/,
  'separate legacy auth buttons must not return');
assert.match(ui, /data-auth-mode="login"[\s\S]*>登录</,
  'combined auth entry must contain a login tab');
assert.match(ui, /data-auth-mode="register"[\s\S]*>注册</,
  'combined auth entry must contain a registration tab');
assert.match(ui, /name="username"/);
assert.match(ui, /name="password" type="password"/);
assert.match(ui, /name="passwordConfirm" type="password"/,
  'registration form must confirm the password');
assert.match(ui, /renderAuthForm\(body, 'login'\)/,
  'combined auth page must default to the login form');

assert.match(auth, /passwordLoginEnabled: boolean/,
  'client account state must distinguish a recoverable registered account from an anonymous profile');
assert.match(auth, /password_login_enabled === true/,
  'registered state must come from the server account projection');
assert.match(ui, /if \(!cached\?\.passwordLoginEnabled\)[\s\S]*flashLoginRequired\(\)/,
  'profile edits must be blocked in guest state');
assert.match(ui, /toast\.textContent = '请先登录账户'/,
  'guest edit attempts must show the requested message');
assert.match(ui, /LOGIN_REQUIRED_MS = 2_000/,
  'login-required hint must last two seconds');

assert.match(ui, /id="kbProfileEditForm"/,
  'profile editing must use one ordinary form instead of sequential prompts');
assert.match(ui, /name="displayName"/,
  'profile form must include display name');
assert.match(ui, /name="avatarUrl" type="url"/,
  'profile form must include avatar URL');
assert.match(ui, /textarea name="bio" maxlength="280"/,
  'profile form must include the bio field');
assert.match(ui, />保存资料</,
  'profile form must save all fields together');
assert.doesNotMatch(ui, /\bprompt\s*\(/,
  'account UI must not use sequential browser prompt dialogs');

assert.match(profileGate, /'password_login_enabled', p\.password_login_enabled/,
  'get_my_account must expose the authoritative permanent-login state');
assert.match(profileGate, /where p\.user_id = actor[\s\S]*and p\.password_login_enabled/,
  'server must reject anonymous profile edits even if the UI is bypassed');
assert.match(profileGate, /raise exception '请先登录账户'/,
  'server profile gate must return the same product-level requirement');
assert.match(profileGate, /knowledge_ball_schema_version\(\)[\s\S]*202608200003/,
  'release schema gate must advance with the profile-auth invariant');

assert.doesNotMatch(ui, /write_entry|刷新余额/i);
for (const item of ['drop function public.register_verified_phone','legacy_phone_registration_registry','legacy_phone_referrals','ensure_anonymous_profile','0.000000']) {
  assert.ok(migration.includes(item), `missing cleanup: ${item}`);
}
console.log('Combined account auth form, standard profile form, and profile edit login gate checks passed');
