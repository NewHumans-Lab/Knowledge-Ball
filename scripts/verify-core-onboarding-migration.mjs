import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/202609040001_core_onboarding_account_status.sql', 'utf8');

assert.match(migration, /add column if not exists core_onboarding_status text/i,
  'profile schema must persist account onboarding status');
assert.match(migration, /check \(core_onboarding_status is null or core_onboarding_status in \('completed', 'skipped'\)\)/i,
  'database must accept only pending NULL or the two permanent final states');
assert.match(migration, /update public\.knowledge_ball_profiles\s+set core_onboarding_status = 'skipped'\s+where core_onboarding_status is null;/i,
  'all identities that predate rollout must be permanently excluded, including on a brand-new device');
assert.doesNotMatch(migration, /default\s+'skipped'/i,
  'post-rollout identities must remain NULL by default so genuine newcomers still receive the guide');
assert.match(migration, /if new_status is null or new_status not in \('completed', 'skipped'\)/i,
  'RPC must reject NULL and non-final status writes');
assert.match(migration, /where user_id = actor\s+and core_onboarding_status is null;/i,
  'RPC must be identity-owned and first-write-only');
assert.match(migration, /revoke all on function public\.set_core_onboarding_status\(text\) from public, anon;/i,
  'privileged RPC must not inherit public/anon execution');
assert.match(migration, /grant execute on function public\.set_core_onboarding_status\(text\) to authenticated;/i,
  'authenticated identities must be able to persist their own final state');
assert.match(migration, /'core_onboarding_status', p\.core_onboarding_status/i,
  'account snapshot must expose the cross-device final state');
assert.match(migration, /select '202609040001'::text/i,
  'schema version must advance with the rollout migration');

console.log('Account-scoped newcomer onboarding migration semantics passed');
