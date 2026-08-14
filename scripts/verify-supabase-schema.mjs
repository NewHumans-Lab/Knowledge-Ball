const expected = process.env.EXPECTED_SCHEMA_VERSION ?? '202608140003';
const base = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
if (!base || !key) throw new Error('Supabase release preflight requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');

const signup = await fetch(`${base}/auth/v1/signup`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
const session = await signup.json();
if (!signup.ok || !session.access_token) throw new Error(`anonymous schema preflight session failed (${signup.status})`);
const response = await fetch(`${base}/rest/v1/rpc/knowledge_ball_schema_version`, {
  method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: '{}',
});
const version = await response.json();
if (!response.ok) throw new Error(`hosted Supabase schema preflight failed (${response.status}): ${JSON.stringify(version)}`);
if (version !== expected) throw new Error(`hosted Supabase schema ${version} does not match required ${expected}`);
console.log(`Hosted Supabase schema preflight passed: ${version}`);
