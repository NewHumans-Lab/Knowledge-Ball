import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrations = await readFile('supabase/migrations/202608140002_issue45_hardening.sql', 'utf8');
const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');
const canonical = await readFile('supabase/migrations/202608140003_canonical_status_events.sql', 'utf8');

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
for (const eventType of ['KnowledgeAdded','KnowledgeNegated','KnowledgeDecomposed','KnowledgeMerged','KnowledgeStatusChanged','KnowledgeNodeEdited']) {
  assert.ok(canonical.includes(eventType), `hosted canonical contract is missing ${eventType}`);
}
assert.match(canonical, /perform public\.validate_public_knowledge_event\(item\)/,
  'every append must pass the authoritative hosted event validator');

console.log('Issue #45 release, privacy, concurrency, and idempotency checks passed');
