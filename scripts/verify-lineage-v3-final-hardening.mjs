import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/202608220010_lineage_v3_final_hardening.sql', 'utf8');
const authClient = readFileSync('src/auth/AuthClient.ts', 'utf8');
const lineageUi = readFileSync('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');
const uiGuard = readFileSync('src/ui/panels/LineageV3Hardening.css', 'utf8');

assert.match(migration, /private\.is_eligible_public_voter\(target_user_id uuid\)/,
  'one server voter-eligibility predicate must own public-truth authorization');
assert.match(migration, /p\.active[\s\S]*p\.password_login_enabled[\s\S]*u\.is_anonymous is false/,
  'eligible public voters must be active permanent accounts');
assert.match(migration, /private\.eligible_public_voter_count\(new\.opened_at\)/g,
  'pending and V1 revalidation snapshots must use the permanent-account population');
assert.match(migration, /before insert on public\.knowledge_pending_votes[\s\S]*private\.require_eligible_pending_voter/,
  'INITIAL/CASCADE ballot persistence must reject ineligible voters server-side');
assert.match(migration, /before insert on private\.knowledge_revalidation_votes[\s\S]*private\.require_eligible_revalidation_voter/,
  'human V1 ballot persistence must reject ineligible voters server-side');
assert.match(migration, /KNOWLEDGE_LINEAGE_V3_CASCADE/,
  'automatic cascade rounds need an explicit protocol identity');
assert.match(migration, /new\.round_kind = 'CASCADE'[\s\S]*new\.policy_version := 'KNOWLEDGE_LINEAGE_V3_CASCADE'/,
  'future cascade rounds must receive the cascade policy identity at insertion');
assert.match(migration, /normalize\(value, NFKC\)/,
  'database title canonicalization must use NFKC compatibility normalization');
assert.match(migration, /candidate_logic_rule_id is distinct from target_logic_rule_id/,
  'lineage candidates must inherit logic-rule identity at the server boundary');
assert.match(migration, /'KnowledgeStatusChanged'[\s\S]*public truth lifecycle\/status events are server-only/,
  'ordinary public event append must not write public truth status directly');
assert.match(migration, /select '202608220010'::text/,
  'schema feature gate must advance with the hardening migration');

assert.match(authClient, /operationKey = freshOperationKey\('pending-vote', nodeId\)/,
  'a user voting in a later round must receive a fresh pending-vote operation key');
assert.doesNotMatch(authClient, /operation_key:\s*`pending-vote:\$\{nodeId\}`/,
  'node-only pending-vote idempotency keys would collide across rounds');
assert.match(authClient, /roundKind\?: PendingVoteRoundKind/,
  'pending vote snapshots must expose round kind');
assert.match(lineageUi, /snapshot\.roundKind !== 'CASCADE'/,
  'cascade routing must use explicit round kind');
assert.doesNotMatch(lineageUi, /snapshot\.policyVersion !== 'ORIGINAL_DESIGN_V1'/,
  'cascade routing must not infer semantics from V1 policy identity');
assert.match(lineageUi, /import '\.\/LineageV3Hardening\.css'/,
  'the product UI must load the legacy direct-status action guard');
assert.match(uiGuard, /#btnResolve[\s\S]*#btnDispute[\s\S]*display:\s*none\s*!important/,
  'ordinary users must not be shown direct resolve/dispute public-status controls');

console.log('Knowledge Lineage V3 final hardening regression checks passed');
