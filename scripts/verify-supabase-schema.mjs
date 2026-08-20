const expected = process.env.EXPECTED_SCHEMA_VERSION ?? '202608200003';
const expectedClassification = process.env.EXPECTED_CLASSIFICATION_SCHEMA_VERSION ?? '202608200002';
const base = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!base || !key) throw new Error('Supabase release preflight requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');

const signup = await fetch(`${base}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
const session = await signup.json();
if (!signup.ok || !session.access_token) throw new Error(`anonymous schema preflight session failed (${signup.status})`);

async function rpc(name) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`hosted Supabase ${name} preflight failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

const version = await rpc('knowledge_ball_schema_version');
if (version !== expected) throw new Error(`hosted Supabase schema ${version} does not match required ${expected}`);
const classificationVersion = await rpc('knowledge_classification_schema_version');
if (classificationVersion !== expectedClassification) {
  throw new Error(`hosted Supabase classification schema ${classificationVersion} does not match required ${expectedClassification}`);
}
console.log(`Hosted Supabase preflight passed: app=${version}, classification=${classificationVersion}`);
