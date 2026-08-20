import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/202608200001_username_password_personal_state.sql', 'utf8');
const edge = readFileSync('supabase/functions/username-password-auth/index.ts', 'utf8');
const authClient = readFileSync('src/auth/AuthClient.ts', 'utf8');
const authUi = readFileSync('src/ui/AuthUi.ts', 'utf8');
const projection = readFileSync('src/projection/GraphProjection.ts', 'utf8');

assert.match(migration, /personal_knowledge_states[\s\S]*user_id uuid not null references auth\.users\(id\) on delete cascade/,
  'private mastery must belong to the immutable Supabase auth user id');
assert.match(migration, /primary key \(user_id, node_id\)/,
  'one authoritative personal mastery row is required per user and public node');
assert.match(migration, /alter table public\.personal_knowledge_states enable row level security/,
  'private mastery table must have RLS enabled');
assert.match(migration, /revoke all on public\.personal_knowledge_states from public, anon, authenticated/,
  'browser roles must not receive broad direct table access');
assert.match(migration, /where user_id = auth\.uid\(\)/,
  'personal reads must derive ownership from auth.uid() rather than browser input');
assert.match(migration, /mark_my_knowledge_touched/,
  'automatic touched state must have a narrow server API');
assert.match(migration, /when public\.personal_knowledge_states\.mastery = 'none' then 'touched'/,
  'an old browser must never downgrade mastered to touched');
assert.match(migration, /merge_my_personal_knowledge_states/,
  'legacy local mastery needs a one-time conservative cloud migration path');
assert.match(migration, /knowledge_ball_profiles[\s\S]*password_login_enabled/,
  'recoverable username login activation must be stored separately from passwords');
assert.match(migration, /username must be 3-24 lowercase letters, digits, or underscores/,
  'username reservation must enforce the canonical unique handle format server-side');
assert.match(migration, /knowledge_ball_schema_version\(\)[\s\S]*202608200001/,
  'release schema gate must advance with the new private-state contract');

assert.match(edge, /internalEmail\(userId: string\)/,
  'the hidden Supabase Auth alias must derive from immutable user_id, not mutable username');
assert.match(edge, /@identity\.invalid/,
  'internal credential aliases must use a reserved non-user email domain');
assert.match(edge, /admin\/users/,
  'anonymous account upgrade must occur on the trusted server boundary');
assert.match(edge, /password_login_enabled: true/,
  'username lookup must not activate until the password identity is installed');
assert.match(edge, /用户名或密码错误/,
  'login failure must not reveal whether the username exists');
assert.doesNotMatch(authClient, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/,
  'no backend secret key may enter browser code');
assert.match(authClient, /claimUsernamePassword/);
assert.match(authClient, /loginUsernamePassword/);
assert.match(authClient, /getPersonalKnowledgeStates/);
assert.match(authClient, /markKnowledgeTouched/);
assert.match(authUi, /syncPersonalKnowledgeCloud/,
  'account UI must hydrate personal mastery from cloud state');
assert.match(authUi, /PERSONAL_CLOUD_MIGRATION_PREFIX/,
  'legacy personal local state must be migrated only once per user id');
assert.match(authUi, /LOCAL_PERSONAL_OWNER_KEY/,
  'legacy browser state must not be imported into a different signed-in user');
assert.match(projection, /replacePersonalMastery/,
  'cloud snapshot must be able to replace stale local mastery rather than merely append over it');

console.log('Username/password identity and private personal-state architecture checks passed');
