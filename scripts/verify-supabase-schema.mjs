import { discoverSchemaVersion } from './schema-version-contract.mjs';

const appContract = await discoverSchemaVersion('knowledge_ball_schema_version');
const classificationContract = await discoverSchemaVersion('knowledge_classification_schema_version');
const expected = process.env.EXPECTED_SCHEMA_VERSION ?? appContract.version;
const expectedClassification = process.env.EXPECTED_CLASSIFICATION_SCHEMA_VERSION ?? classificationContract.version;
const base = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!base || !key) throw new Error('Supabase release preflight requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchJsonWithRetry(url, init, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      let value;
      try { value = text ? JSON.parse(text) : null; }
      catch { value = text; }

      if (response.ok) return { response, value };
      const retryable = response.status === 429 || response.status >= 500;
      lastError = new Error(`${label} failed (${response.status}): ${JSON.stringify(value)}`);
      if (!retryable) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(attempt * 1_000);
  }
  throw lastError;
}

const { response: signup, value: session } = await fetchJsonWithRetry(
  `${base}/auth/v1/signup`,
  { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' },
  'anonymous schema preflight session',
);
if (!signup.ok || !session?.access_token) throw new Error(`anonymous schema preflight session failed (${signup.status})`);

async function rpc(name) {
  const { value } = await fetchJsonWithRetry(
    `${base}/rest/v1/rpc/${name}`,
    {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: '{}',
    },
    `hosted Supabase ${name} preflight`,
  );
  return value;
}

const version = await rpc('knowledge_ball_schema_version');
if (version !== expected) {
  throw new Error(`hosted Supabase schema ${version} does not match required ${expected} derived from ${appContract.file}`);
}
const classificationVersion = await rpc('knowledge_classification_schema_version');
if (classificationVersion !== expectedClassification) {
  throw new Error(`hosted Supabase classification schema ${classificationVersion} does not match required ${expectedClassification} derived from ${classificationContract.file}`);
}
console.log(`Hosted Supabase preflight passed: app=${version} (${appContract.file}), classification=${classificationVersion} (${classificationContract.file})`);
