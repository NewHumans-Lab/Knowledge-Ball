import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing expected source block: ${label}`);
  return source.replace(before, after);
}

const runtimePath = 'src/ui/voice/VoiceRoomRuntime.ts';
let runtime = readFileSync(runtimePath, 'utf8');
runtime = replaceExact(runtime,
`    try {
      const session = await authClient.session();
      const sdk = await loadSupabaseRealtime();
      if (stopped || realtimeChannel) return;
      const client = sdk.createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });`,
`    try {
      const statusAuthClient = authClient;
      const session = await statusAuthClient.session();
      const sdk = await loadSupabaseRealtime();
      if (stopped || realtimeChannel) return;
      const client = sdk.createClient(supabaseUrl, publishableKey, {
        accessToken: async () => (await statusAuthClient.session()).access_token,
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });`, 'Realtime auth callback');
writeFileSync(runtimePath, runtime);

const testPath = 'src/ui/ProjectionRenderScheduler.test.ts';
let test = readFileSync(testPath, 'utf8');
test = replaceExact(test,
`assert.match(runtime, /client\\.realtime\\.setAuth\\(session\\.access_token\\)/, 'private Realtime must authenticate with the existing Supabase session');`,
`assert.match(runtime, /client\\.realtime\\.setAuth\\(session\\.access_token\\)/, 'private Realtime must authenticate with the existing Supabase session');
assert.match(runtime, /accessToken: async \\(\\) => \\(await statusAuthClient\\.session\\(\\)\\)\\.access_token/, 'the same Realtime connection must refresh its JWT without status polling');`, 'Realtime auth regression assertion');
writeFileSync(testPath, test);

rmSync('scripts/patch-voice-realtime-auth.mjs', { force: true });
rmSync('.github/workflows/patch-voice-realtime-auth.yml', { force: true });
console.log('Patched voice Realtime auth refresh');
