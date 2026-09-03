import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [auth, ui, avatarStorage, app, vite, sync, migration, profileGate, publicWriteGate, accuracyMigration, avatarMigration, productionBrowser, deploy] = await Promise.all([
  readFile('src/auth/AuthClient.ts','utf8'),
  readFile('src/ui/AccountUi.ts','utf8'),
  readFile('src/ui/AvatarStorage.ts','utf8'),
  readFile('src/ui/app.ts','utf8'),
  readFile('vite.config.ts','utf8'),
  readFile('src/sync/SupabaseSyncAdapter.ts','utf8'),
  readFile('supabase/migrations/202608140001_remove_phone_auth.sql','utf8'),
  readFile('supabase/migrations/202608200003_profile_edit_requires_account.sql','utf8'),
  readFile('supabase/migrations/202608200004_registered_public_writes.sql','utf8'),
  readFile('supabase/migrations/202608210002_account_accuracy.sql','utf8'),
  readFile('supabase/migrations/202609030001_profile_avatar_storage.sql','utf8'),
  readFile('scripts/verify-production-browser-zero-write.mjs','utf8'),
  readFile('.github/workflows/deploy.yml','utf8'),
]);

for (const source of [auth, ui, sync]) assert.doesNotMatch(source, /phone|sms|otp|verified_phone|验证码/i);
assert.match(auth, /body: '\{\}'/);
assert.match(auth, /ensure_anonymous_profile/);
assert.match(sync, /append_public_knowledge_events/);
assert.doesNotMatch(sync, /service[_-]?role/i,
  'browser synchronization must never depend on a privileged service-role credential');

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
assert.match(ui, /if \(!this\.cached\?\.passwordLoginEnabled\)[\s\S]*this\.flashLoginRequired\(\)/,
  'profile edits must be blocked in guest state');
assert.match(ui, /toast\.textContent = '请先登录账户'/,
  'guest edit attempts must show the requested message');
assert.match(ui, /LOGIN_REQUIRED_MS = 2_000/,
  'login-required hint must last two seconds');

assert.match(ui, /id="kbProfileEditForm"/,
  'profile editing must use one ordinary form instead of sequential prompts');
assert.match(ui, /name="displayName"/,
  'profile form must include display name');
assert.match(ui, /id="kbAvatarFile"[\s\S]*type="file"[\s\S]*accept="image\/\*"/,
  'profile form must select an avatar from the device image picker');
assert.doesNotMatch(ui, /name="avatarUrl" type="url"/,
  'users must not be asked to paste an avatar URL');
assert.match(ui, /prepareAvatarWebp\(file\)/,
  'selected avatar must be processed before upload');
assert.match(ui, /uploadAvatarWebp\(this\.account, image\)/,
  'processed avatar must be uploaded through the dedicated storage path');
assert.match(ui, /this\.cached = await this\.account\.updateProfile\([\s\S]*avatarUrl/,
  'uploaded avatar URL must be written back to the account profile');
assert.match(ui, /avatar\.removeAttribute\('data-brand-logo'\)[\s\S]*renderAvatarImage\(avatar, this\.cached\)[\s\S]*avatar\.setAttribute\('data-brand-logo', ''\)/,
  'registered users must show profile avatars while guests retain the Knowledge Ball logo');
assert.match(ui, /textarea name="bio" maxlength="280"/,
  'profile form must include the bio field');
assert.match(ui, />保存资料</,
  'profile form must save all fields together');
assert.doesNotMatch(ui, /\bprompt\s*\(/,
  'account UI must not use sequential browser prompt dialogs');

assert.match(avatarStorage, /AVATAR_SIZE = 512/,
  'avatar processing must normalize images to 512px');
assert.match(avatarStorage, /Math\.min\(decoded\.width, decoded\.height\)/,
  'avatar processing must crop the source to a square');
assert.match(avatarStorage, /canvas\.toBlob\([\s\S]*'image\/webp'/,
  'avatar processing must encode WebP in the browser');
assert.match(avatarStorage, /storage\/v1\/object\/\$\{AVATAR_BUCKET\}/,
  'avatar upload must target Supabase Storage');
assert.match(avatarStorage, /'x-upsert': 'true'/,
  'one stable avatar object must be replaced instead of accumulating uploads');
assert.match(avatarStorage, /storage\/v1\/object\/public\/\$\{AVATAR_BUCKET\}/,
  'the stored profile URL must use the public avatar object URL');

assert.match(avatarMigration, /insert into storage\.buckets[\s\S]*'avatars'[\s\S]*'image\/webp'/,
  'avatar migration must create the public WebP-only Storage bucket');
assert.match(avatarMigration, /target_name = auth\.uid\(\)::text \|\| '\/avatar\.webp'/,
  'avatar objects must be fixed to the authenticated user path');
assert.match(avatarMigration, /p\.password_login_enabled[\s\S]*u\.is_anonymous is false/,
  'Supabase anonymous sessions must not gain avatar write access');
assert.match(avatarMigration, /for insert[\s\S]*for select[\s\S]*for update/,
  'avatar upserts must have the exact Storage RLS permissions they require');

assert.match(app, /const accountUi = installAccountUi\(/,
  'every shell must install account presentation through one explicit application integration point');
assert.match(app, /getLocalPersonalStates: latestLocalPersonalStates/,
  'account UI must receive local personal state through an explicit read port');
assert.match(app, /applyPersonalSnapshot: applyPersonalKnowledgeSnapshot/,
  'account UI must apply cloud personal state through an explicit application write port');
assert.doesNotMatch(ui, /window\.__debug|MutationObserver|currentPanelNode|stopImmediatePropagation/,
  'account UI must not infer business identity from DOM mutations or debug internals');
assert.doesNotMatch(vite, /AuthUi\.ts/,
  'native builds must not inject a parallel legacy account product UI');
assert.doesNotMatch(app, /!Capacitor\.isNativePlatform\(\)[\s\S]{0,80}installAccountUi/,
  'the current Account UI must not be restricted to Web');

assert.match(profileGate, /'password_login_enabled', p\.password_login_enabled/,
  'get_my_account must expose the authoritative permanent-login state');
assert.match(profileGate, /where p\.user_id = actor[\s\S]*and p\.password_login_enabled/,
  'server must reject anonymous profile edits even if the UI is bypassed');
assert.match(profileGate, /raise exception '请先登录账户'/,
  'server profile gate must return the same product-level requirement');

assert.match(accuracyMigration, /account_positions[\s\S]*initiator_id[\s\S]*initiator_side/,
  'accuracy must include creator positions');
assert.match(accuracyMigration, /knowledge_pending_votes[\s\S]*settlement_status = 'ACTIVE'/,
  'accuracy must include only valid ordinary-vote positions');
assert.match(accuracyMigration, /\bunion\b/i,
  'claim-side positions must be deduplicated across creator and vote history');
assert.match(accuracyMigration, /r\.verdict in \('CORRECT', 'INCORRECT'\)/,
  'pending verification rounds must not enter accuracy attempts');
assert.match(accuracyMigration, /position\.side = 'AGREE'[\s\S]*verdict\.verdict = 'CORRECT'[\s\S]*position\.side = 'DISAGREE'[\s\S]*verdict\.verdict = 'INCORRECT'/,
  'accuracy wins must match the frozen AGREE/CORRECT and DISAGREE/INCORRECT rule');
assert.match(accuracyMigration, /100\.0 \* score\.wins/,
  'database accuracy must return the percent value rendered by the account UI');
assert.match(accuracyMigration, /202608210002/,
  'release schema gate must advance with authoritative account accuracy');

assert.match(publicWriteGate, /append_public_knowledge_events\(/,
  'public-write hardening migration must own the authoritative append RPC');
assert.match(publicWriteGate, /join auth\.users u on u\.id = p\.user_id/,
  'public writes must cross-check the authoritative auth user');
assert.match(publicWriteGate, /p\.active/,
  'inactive Knowledge Ball accounts must not write public knowledge');
assert.match(publicWriteGate, /p\.password_login_enabled/,
  'anonymous guest profiles must not write public knowledge');
assert.match(publicWriteGate, /u\.is_anonymous is false/,
  'Supabase anonymous auth users must be rejected server-side');
assert.match(publicWriteGate, /请先注册或登录账户后再提交公共知识/,
  'rejected guest writes must return a product-level authorization message');
assert.match(publicWriteGate, /knowledge_ball_schema_version\(\)[\s\S]*202608200004/,
  'public-write migration must preserve its own historical schema milestone');

assert.doesNotMatch(productionBrowser, /route\.continue\(|route\.fallback\(|fetch\(/,
  'production browser gate must never let a Supabase request reach the hosted service');
assert.match(productionBrowser, /page\.route\('\*\*\/\*\.supabase\.co\/\*\*'/,
  'production browser gate must intercept every Supabase request');
assert.match(productionBrowser, /CI zero-write gate blocked an unexpected Supabase request/,
  'unexpected Supabase calls must fail closed instead of reaching production');
assert.match(productionBrowser, /external Supabase requests: 0/,
  'production smoke output must make the zero-write invariant visible');
assert.doesNotMatch(deploy, /\?e2e=/,
  'production deploy must not parameterize a test knowledge marker');
assert.match(deploy, /Zero-write deployed Pages browser gate/,
  'deployment must describe the production browser check as zero-write');
assert.doesNotMatch(deploy, /verify-production-browser\.mjs|verify-live-visibility-cycle\.mjs/,
  'deployment must not restore the old database-touching browser gates');

assert.doesNotMatch(ui, /write_entry|刷新余额/i);
for (const item of ['drop function public.register_verified_phone','legacy_phone_registration_registry','legacy_phone_referrals','ensure_anonymous_profile','0.000000']) {
  assert.ok(migration.includes(item), `missing cleanup: ${item}`);
}
console.log('Registered public-write gate, avatar upload boundary, explicit account ownership, authoritative accuracy, zero-write production smoke, and account UI checks passed');
// This regression intentionally guards the web account ownership boundary.
