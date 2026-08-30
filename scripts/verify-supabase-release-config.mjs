import { discoverSchemaVersion } from './schema-version-contract.mjs';

const appContract = await discoverSchemaVersion('knowledge_ball_schema_version');
const classificationContract = await discoverSchemaVersion('knowledge_classification_schema_version');
const expected = process.env.EXPECTED_SCHEMA_VERSION ?? appContract.version;
const expectedClassification = process.env.EXPECTED_CLASSIFICATION_SCHEMA_VERSION ?? classificationContract.version;
const base = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';

if (!base || !key) {
  throw new Error('Supabase release configuration requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');
}

let projectUrl;
try {
  projectUrl = new URL(base);
} catch {
  throw new Error('VITE_SUPABASE_URL must be a valid URL');
}

if (projectUrl.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/i.test(projectUrl.hostname) || projectUrl.pathname !== '/') {
  throw new Error(`VITE_SUPABASE_URL must be a canonical Supabase project URL, got ${base}`);
}
if (!key.startsWith('sb_publishable_')) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must use a modern sb_publishable_ key');
}
if (expected !== appContract.version) {
  throw new Error(`required app schema ${expected} does not match repository contract ${appContract.version} from ${appContract.file}`);
}
if (expectedClassification !== classificationContract.version) {
  throw new Error(`required classification schema ${expectedClassification} does not match repository contract ${classificationContract.version} from ${classificationContract.file}`);
}

console.log(
  `Supabase zero-write release configuration passed: project=${projectUrl.hostname}, app=${appContract.version} (${appContract.file}), classification=${classificationContract.version} (${classificationContract.file})`,
);
