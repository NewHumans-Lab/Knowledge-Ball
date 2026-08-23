import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverSchemaVersion } from './schema-version-contract.mjs';

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const interaction = await readFile('src/ui/interaction/InteractionController.ts', 'utf8');
const app = await readFile('src/ui/app.ts', 'utf8');
const vite = await readFile('vite.config.ts', 'utf8');
const freshness = await readFile('src/ui/BuildFreshness.ts', 'utf8');
const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');
const schemaGate = await readFile('scripts/verify-supabase-schema.mjs', 'utf8');

assert(interaction.includes('export interface InteractionScenePort'), 'interaction must depend on a narrow scene port');
assert(interaction.includes('setVisibilityMode: (mode: KnowledgeVisibilityMode) => void;'), 'three-state setVisibilityMode must be the interaction scene authority');
assert(!interaction.includes('KnowledgeSceneRuntime'), 'interaction must not regain the full scene runtime and its legacy binary APIs');
assert(!interaction.includes('setHideUntouched'), 'binary hide/show semantics must not exist in the interaction controller');
assert.equal((interaction.match(/personalButton\.addEventListener\('click'/g) ?? []).length, 1, 'Personal control must bind exactly one click listener');
assert(interaction.includes('nextKnowledgeVisibilityMode(this.visibilityMode)'), 'Personal control must advance through the canonical three-state transition');
assert(interaction.includes('getVisibilityMode(): KnowledgeVisibilityMode'), 'browser acceptance must be able to verify controller truth rather than DOM text alone');
assert.equal((app.match(/new InteractionController\(/g) ?? []).length, 1, 'application must construct exactly one interaction controller');

for (const file of await sourceFiles('src')) {
  if (file.endsWith('src/ui/scene/KnowledgeScene.ts')) continue;
  const text = await readFile(file, 'utf8');
  assert(!text.includes('setHideUntouched'), `${file} must not call or expose the legacy binary visibility setter`);
}

assert(vite.includes('knowledge-ball-canonical-visibility-shell'), 'built HTML must canonicalize the Current shell before runtime boot');
assert(vite.includes("src: '/src/ui/BuildFreshness.ts'"), 'every built Pages shell must install the build freshness guard');
assert(freshness.includes("cache: 'no-store'"), 'freshness probe must bypass the browser HTTP cache');
assert(freshness.includes("window.addEventListener('pageshow'"), 'BFCache/long-lived tabs must recheck deployment identity on pageshow');
assert(freshness.includes("document.addEventListener('visibilitychange'"), 'foregrounded mobile tabs must recheck deployment identity');
assert(deploy.includes('verify-live-visibility-cycle.mjs'), 'deployment must end with the real-touch three-state production gate');

assert(schemaGate.includes("discoverSchemaVersion('knowledge_ball_schema_version')"), 'release gate must derive app schema truth from migrations');
assert(schemaGate.includes("discoverSchemaVersion('knowledge_classification_schema_version')"), 'release gate must derive classification schema truth from migrations');
assert(!schemaGate.includes("?? '202608210002'"), 'release gate must never restore the stale manually copied app schema constant');
const appSchema = await discoverSchemaVersion('knowledge_ball_schema_version');
const classificationSchema = await discoverSchemaVersion('knowledge_classification_schema_version');
assert(appSchema.file.startsWith(`${appSchema.version}_`), 'app schema function must declare the version of the migration that owns it');
assert(classificationSchema.file.startsWith(`${classificationSchema.version}_`), 'classification schema function must declare the version of the migration that owns it');

console.log(`Three-state visibility architecture checks passed; schema gate follows ${appSchema.file} (${appSchema.version}).`);
