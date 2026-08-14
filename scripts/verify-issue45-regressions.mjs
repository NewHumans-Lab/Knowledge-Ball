import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrations = await readFile('supabase/migrations/202608140002_issue45_hardening.sql', 'utf8');
const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');

assert.match(migrations, /revoke select\(user_id, account_no, active\)/i,
  'authenticated callers must not enumerate permanent identity fields');
assert.match(migrations, /order by user_id[\s\S]*for update/i,
  'opposite transfers must lock both users in deterministic order');
assert.match(migrations, /request_hash/i,
  'idempotency must bind a key to actor, operation, and request parameters');
assert.match(migrations, /knowledge_ball_schema_version/i,
  'the hosted schema must expose a release preflight version');
assert.match(deploy, /npm ci/);
assert.match(deploy, /npm test/);
assert.match(deploy, /verify-supabase-schema/);

console.log('Issue #45 release, privacy, concurrency, and idempotency checks passed');
