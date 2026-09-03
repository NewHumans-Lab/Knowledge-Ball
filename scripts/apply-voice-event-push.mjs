import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing expected source block: ${label}`);
  return source.replace(before, after);
}

const runtimePath = 'src/ui/voice/VoiceRoomRuntime.ts';
let runtime = readFileSync(runtimePath, 'utf8');

runtime = replaceExact(runtime,
`export const LIVEKIT_CLIENT_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.1/dist/livekit-client.umd.min.js';
export const VOICE_ROOM_PREFIX = 'knowledge:';
const STATUS_INTERVAL_MS = 2500;
const STATUS_BACKOFF_MAX_MS = 60_000;
const SPEAKING_HEARTBEAT_MS = 900;`,
`export const LIVEKIT_CLIENT_CDN = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.1/dist/livekit-client.umd.min.js';
export const SUPABASE_REALTIME_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0/dist/umd/supabase.js';
export const VOICE_ROOM_PREFIX = 'knowledge:';
export const VOICE_ROOM_STATUS_TOPIC = 'voice-room-status';
const SPEAKING_HEARTBEAT_MS = 900;`, 'runtime constants');

runtime = replaceExact(runtime,
`type LiveKitGlobal = {
  Room: new (options?: Record<string, unknown>) => LiveKitRoom;
  RoomEvent: Record<string, string>;
  isBrowserSupported?: () => boolean;
};
`,
`type LiveKitGlobal = {
  Room: new (options?: Record<string, unknown>) => LiveKitRoom;
  RoomEvent: Record<string, string>;
  isBrowserSupported?: () => boolean;
};
type RealtimeChannel = {
  on: (type: 'broadcast', filter: { event: string }, listener: (payload: unknown) => void) => RealtimeChannel;
  subscribe: (listener?: (status: string) => void) => RealtimeChannel;
};
type SupabaseRealtimeClient = {
  realtime: { setAuth: (token?: string) => Promise<void> };
  channel: (topic: string, options: { config: { private: boolean } }) => RealtimeChannel;
};
type SupabaseGlobal = {
  createClient: (url: string, key: string, options?: Record<string, unknown>) => SupabaseRealtimeClient;
};
`, 'realtime types');

runtime = replaceExact(runtime,
`  return liveKitLoadPromise;
}

export function installVoiceRoomRuntime(): void {`,
`  return liveKitLoadPromise;
}

let supabaseLoadPromise: Promise<SupabaseGlobal> | null = null;

function loadSupabaseRealtime(): Promise<SupabaseGlobal> {
  const current = (window as unknown as { supabase?: SupabaseGlobal }).supabase;
  if (current) return Promise.resolve(current);
  if (supabaseLoadPromise) return supabaseLoadPromise;

  supabaseLoadPromise = new Promise((resolve, reject) => {
    let existing = document.querySelector<HTMLScriptElement>('script[data-knowledge-ball-supabase]');
    if (existing?.dataset.supabaseFailed === '1' || existing?.dataset.supabaseLoaded === '1') {
      existing.remove();
      existing = null;
    }
    const script = existing ?? document.createElement('script');
    const cleanupFailure = () => {
      script.dataset.supabaseFailed = '1';
      script.remove();
      supabaseLoadPromise = null;
      reject(new Error('Supabase Realtime SDK failed to load'));
    };
    const finish = () => {
      const sdk = (window as unknown as { supabase?: SupabaseGlobal }).supabase;
      if (!sdk) {
        cleanupFailure();
        return;
      }
      script.dataset.supabaseLoaded = '1';
      resolve(sdk);
    };
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', cleanupFailure, { once: true });
    if (!existing) {
      script.src = SUPABASE_REALTIME_CDN;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.dataset.knowledgeBallSupabase = '1';
      document.head.appendChild(script);
    }
  });

  return supabaseLoadPromise;
}

export function installVoiceRoomRuntime(): void {`, 'supabase loader');

runtime = replaceExact(runtime,
`  let lastSpeakingHeartbeat = 0;
  let speakingTimer: number | null = null;
  let statusTimer: number | null = null;
  let statusFailures = 0;
  let renderRaf = 0;`,
`  let lastSpeakingHeartbeat = 0;
  let speakingTimer: number | null = null;
  let realtimeClient: SupabaseRealtimeClient | null = null;
  let realtimeChannel: RealtimeChannel | null = null;
  let renderRaf = 0;`, 'runtime state');

runtime = replaceExact(runtime,
`  const scheduleStatus = (delay: number) => {
    if (stopped) return;
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      statusTimer = null;
      void refreshStatus();
    }, delay);
  };

  const refreshStatus = async () => {
    if (stopped) return;
    try {
      const next = parseVoiceRoomStatusPayload(await voiceRequest({ action: 'status' }));
      statuses.clear();
      for (const item of next) statuses.set(item.nodeId, item);
      statusFailures = 0;
      ensureRenderLoop();
      scheduleStatus(document.hidden ? 15_000 : STATUS_INTERVAL_MS);
    } catch (error) {
      statusFailures += 1;
      if (import.meta.env.DEV) console.debug('[Knowledge-Ball voice] status unavailable', error);
      const permanentConfigurationError = error instanceof VoiceServiceError && error.status === 503;
      const exponential = Math.min(STATUS_BACKOFF_MAX_MS, STATUS_INTERVAL_MS * (2 ** Math.min(statusFailures, 5)));
      const delay = document.hidden ? STATUS_BACKOFF_MAX_MS : permanentConfigurationError ? STATUS_BACKOFF_MAX_MS : exponential;
      scheduleStatus(delay);
    }
  };
`,
`  const refreshStatus = async () => {
    if (stopped) return;
    try {
      const next = parseVoiceRoomStatusPayload(await voiceRequest({ action: 'status' }));
      statuses.clear();
      for (const item of next) statuses.set(item.nodeId, item);
      ensureRenderLoop();
    } catch (error) {
      if (import.meta.env.DEV) console.debug('[Knowledge-Ball voice] initial status unavailable', error);
    }
  };

  const applyRealtimeStatus = (payload: unknown) => {
    const envelope = payload as { payload?: unknown };
    if (!envelope?.payload || typeof envelope.payload !== 'object') return;
    const change = envelope.payload as Record<string, unknown>;
    const nodeId = typeof change.nodeId === 'string' ? change.nodeId : '';
    const participants = Number(change.participants);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(nodeId)) return;
    if (!Number.isSafeInteger(participants) || participants < 0) return;
    if (participants === 0) statuses.delete(nodeId);
    else statuses.set(nodeId, { nodeId, participants, speaking: false });
    ensureRenderLoop();
  };

  const connectStatusRealtime = async () => {
    if (stopped || realtimeChannel || !authClient || !supabaseUrl || !publishableKey) return;
    try {
      const session = await authClient.session();
      const sdk = await loadSupabaseRealtime();
      if (stopped || realtimeChannel) return;
      const client = sdk.createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await client.realtime.setAuth(session.access_token);
      const channel = client
        .channel(VOICE_ROOM_STATUS_TOPIC, { config: { private: true } })
        .on('broadcast', { event: 'voice_room_status_changed' }, applyRealtimeStatus);
      realtimeClient = client;
      realtimeChannel = channel;
      channel.subscribe(status => {
        if (import.meta.env.DEV && status !== 'SUBSCRIBED') console.debug('[Knowledge-Ball voice] realtime status', status);
      });
    } catch (error) {
      if (import.meta.env.DEV) console.debug('[Knowledge-Ball voice] realtime unavailable', error);
    }
  };

  const initializeStatusPush = async () => {
    await refreshStatus();
    if (stopped) return;
    await connectStatusRealtime();
  };
`, 'polling implementation');

runtime = replaceExact(runtime,
`  const leaveRoom = async () => {
    joinSerial += 1;
    await disconnectTrackedRooms();
    ensureRenderLoop();
    void refreshStatus();
  };`,
`  const leaveRoom = async () => {
    joinSerial += 1;
    await disconnectTrackedRooms();
    ensureRenderLoop();
  };`, 'leave refresh');

runtime = runtime.replace("      nextRoom.on(events.ParticipantConnected, () => { if (room === nextRoom) void refreshStatus(); });\n", '');
runtime = runtime.replace("      nextRoom.on(events.ParticipantDisconnected, () => { if (room === nextRoom) void refreshStatus(); });\n", '');
runtime = runtime.replace("        void refreshStatus();\n", '');
runtime = runtime.replace("      await refreshStatus();\n", '');

runtime = replaceExact(runtime,
`  const suspendRuntime = () => {
    if (stopped) return;
    stopped = true;
    joinSerial += 1;
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (renderRaf !== 0) {`,
`  const suspendRuntime = () => {
    if (stopped) return;
    stopped = true;
    joinSerial += 1;
    if (renderRaf !== 0) {`, 'suspend polling cleanup');

runtime = replaceExact(runtime,
`  const resumeRuntime = () => {
    if (!stopped) return;
    stopped = false;
    statusFailures = 0;
    scheduleStatus(0);
    ensureRenderLoop();
  };`,
`  const resumeRuntime = () => {
    if (!stopped) return;
    stopped = false;
    ensureRenderLoop();
  };`, 'resume polling');

runtime = replaceExact(runtime,
`  document.addEventListener('visibilitychange', () => {
    if (stopped) return;
    if (document.hidden) {
      scheduleStatus(STATUS_BACKOFF_MAX_MS);
    } else {
      statusFailures = 0;
      scheduleStatus(0);
      ensureRenderLoop();
    }
  });

  scheduleStatus(0);
  ensureRenderLoop();`,
`  document.addEventListener('visibilitychange', () => {
    if (!stopped && !document.hidden) ensureRenderLoop();
  });

  void initializeStatusPush();
  ensureRenderLoop();`, 'visibility/init polling');

writeFileSync(runtimePath, runtime);

const testPath = 'src/ui/ProjectionRenderScheduler.test.ts';
let test = readFileSync(testPath, 'utf8');
test = replaceExact(test,
`  LIVEKIT_CLIENT_CDN,
  parseVoiceRoomStatusPayload,
  roomNameForNode,`,
`  LIVEKIT_CLIENT_CDN,
  SUPABASE_REALTIME_CDN,
  VOICE_ROOM_STATUS_TOPIC,
  parseVoiceRoomStatusPayload,
  roomNameForNode,`, 'test imports');

test = replaceExact(test,
`assert.match(LIVEKIT_CLIENT_CDN, /livekit-client@2\\.22\\.1/, 'browser SDK must be version-pinned');`,
`assert.match(LIVEKIT_CLIENT_CDN, /livekit-client@2\\.22\\.1/, 'browser SDK must be version-pinned');
assert.match(SUPABASE_REALTIME_CDN, /supabase-js@2\\.109\\.0/, 'Realtime browser SDK must be version-pinned');
assert.equal(VOICE_ROOM_STATUS_TOPIC, 'voice-room-status', 'all clients must share exactly one voice status Broadcast topic');`, 'test constants');

test = replaceExact(test,
`assert.match(runtime, /window\\.addEventListener\\('pageshow', resumeRuntime\\)/, 'bfcache restores must resume voice status/render scheduling');
assert.match(runtime, /if \\(wanted\\.size > 0\\) renderRaf = window\\.requestAnimationFrame\\(renderMarkers\\)/, 'voice DOM rendering must sleep when there are no markers');
assert.match(runtime, /STATUS_BACKOFF_MAX_MS/, 'unavailable voice backends must use bounded polling backoff');`,
`assert.match(runtime, /window\\.addEventListener\\('pageshow', resumeRuntime\\)/, 'bfcache restores must resume voice rendering');
assert.match(runtime, /if \\(wanted\\.size > 0\\) renderRaf = window\\.requestAnimationFrame\\(renderMarkers\\)/, 'voice DOM rendering must sleep when there are no markers');
assert.doesNotMatch(runtime, /STATUS_INTERVAL_MS|STATUS_BACKOFF_MAX_MS|scheduleStatus|statusTimer/, 'voice room counts must never return to timer polling');
assert.match(runtime, /await refreshStatus\\(\\);[\\s\\S]*await connectStatusRealtime\\(\\);/, 'client must take one initial snapshot before establishing Realtime');
assert.match(runtime, /channel\\(VOICE_ROOM_STATUS_TOPIC, \\{ config: \\{ private: true \\} \\}\\)/, 'voice count updates must use one private Broadcast channel');
assert.match(runtime, /\\.on\\('broadcast', \\{ event: 'voice_room_status_changed' \\}/, 'voice count changes must arrive through Broadcast');
assert.match(runtime, /client\\.realtime\\.setAuth\\(session\\.access_token\\)/, 'private Realtime must authenticate with the existing Supabase session');
assert.doesNotMatch(runtime, /ParticipantConnected[^\\n]+refreshStatus|ParticipantDisconnected[^\\n]+refreshStatus/, 'LiveKit participant events must not trigger client status queries');`, 'test runtime assertions');

test = replaceExact(test,
`assert.match(edgeFunction, /roomService\\.listRooms\\(\\)/, 'participant counts must come from active LiveKit rooms');`,
`assert.match(edgeFunction, /roomService\\.listRooms\\(\\)/, 'the one-time opening snapshot must come from active LiveKit rooms');`, 'snapshot assertion');

test = replaceExact(test,
`assert.doesNotMatch(edgeFunction, /camera|screen_share/, 'voice join grants must not authorize camera or screen sharing');

console.log('Projection render scheduler + end-to-end node voice-room regression tests passed');`,
`assert.doesNotMatch(edgeFunction, /camera|screen_share/, 'voice join grants must not authorize camera or screen sharing');

const webhookFunction = readFileSync('supabase/functions/livekit-webhook/index.ts', 'utf8');
assert.match(webhookFunction, /WebhookReceiver/, 'LiveKit webhooks must be cryptographically verified');
assert.match(webhookFunction, /participant_joined/, 'join webhooks must update voice room status');
assert.match(webhookFunction, /participant_left/, 'leave webhooks must update voice room status');
assert.match(webhookFunction, /roomService\\.listParticipants\\(roomName\\)/, 'each webhook must resolve the current room participant count once');
assert.match(webhookFunction, /voice_room_status/, 'webhook status must be persisted in voice_room_status');
assert.match(webhookFunction, /on_conflict=node_id/, 'room status writes must upsert one row per knowledge node');

const voiceMigration = readFileSync('supabase/migrations/202609030003_voice_room_status_realtime.sql', 'utf8');
assert.match(voiceMigration, /create table if not exists public\\.voice_room_status/i, 'migration must create the voice room snapshot table');
assert.match(voiceMigration, /realtime\\.send\\(/, 'database status changes must use Realtime Broadcast');
assert.match(voiceMigration, /'voice-room-status'/, 'database Broadcast topic must match the client topic');
assert.match(voiceMigration, /'voice_room_status_changed'/, 'database Broadcast event must match the client listener');
assert.match(voiceMigration, /on realtime\\.messages/i, 'private Broadcast must be protected by Realtime Authorization');

const supabaseConfig = readFileSync('supabase/config.toml', 'utf8');
assert.match(supabaseConfig, /\\[functions\\.livekit-webhook\\][\\s\\S]*verify_jwt\\s*=\\s*false/, 'external LiveKit webhook must bypass Supabase JWT verification and use LiveKit signature verification');

console.log('Projection render scheduler + end-to-end node voice-room regression tests passed');`, 'webhook regression tests');
writeFileSync(testPath, test);

mkdirSync('supabase/functions/livekit-webhook', { recursive: true });
writeFileSync('supabase/functions/livekit-webhook/index.ts', `import { RoomServiceClient, WebhookReceiver } from 'npm:livekit-server-sdk@2.18.0';

const ROOM_PREFIX = 'knowledge:';
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requiredEnv(name) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(\`Missing \${name}\`);
  return value;
}

function normalizeLiveKitUrl(value) {
  if (value.startsWith('wss://')) return \`https://\${value.slice('wss://'.length)}\`;
  if (value.startsWith('ws://')) return \`http://\${value.slice('ws://'.length)}\`;
  return value.replace(/\\/$/, '');
}

function readSecretKey() {
  const named = Deno.env.get('SUPABASE_SECRET_KEYS')?.trim();
  if (named) {
    try {
      const parsed = JSON.parse(named);
      if (typeof parsed.default === 'string' && parsed.default.trim()) return parsed.default.trim();
      for (const value of Object.values(parsed)) if (typeof value === 'string' && value.trim()) return value.trim();
    } catch { /* fall through to legacy secret */ }
  }
  return requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
}

async function writeRoomStatus(nodeId, participants) {
  const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\\/$/, '');
  const secretKey = readSecretKey();
  const headers = {
    apikey: secretKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  if (!secretKey.startsWith('sb_secret_')) headers.Authorization = \`Bearer \${secretKey}\`;
  const response = await fetch(\`\${supabaseUrl}/rest/v1/voice_room_status?on_conflict=node_id\`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ node_id: nodeId, participants, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(\`voice_room_status write failed: \${response.status} \${await response.text()}\`);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  try {
    const apiKey = requiredEnv('LIVEKIT_API_KEY');
    const apiSecret = requiredEnv('LIVEKIT_API_SECRET');
    const roomService = new RoomServiceClient(normalizeLiveKitUrl(requiredEnv('LIVEKIT_URL')), apiKey, apiSecret);
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    const rawBody = await req.text();
    const event = await receiver.receive(rawBody, req.headers.get('Authorization') ?? undefined);

    if (event.event !== 'participant_joined' && event.event !== 'participant_left') {
      return Response.json({ accepted: true });
    }

    const roomName = event.room?.name ?? '';
    if (!roomName.startsWith(ROOM_PREFIX)) return Response.json({ accepted: true });
    const nodeId = roomName.slice(ROOM_PREFIX.length);
    if (!NODE_ID.test(nodeId)) return Response.json({ accepted: true });

    let participants = Math.max(0, Number(event.room?.numParticipants ?? 0));
    try {
      participants = (await roomService.listParticipants(roomName)).length;
    } catch {
      // The room can disappear between participant_left and the lookup. The signed webhook room count is the fallback.
    }
    await writeRoomStatus(nodeId, participants);
    return Response.json({ accepted: true, nodeId, participants });
  } catch (error) {
    console.error('[livekit-webhook]', error);
    return Response.json({ error: 'Invalid LiveKit webhook' }, { status: 401 });
  }
});
`);

mkdirSync('supabase/migrations', { recursive: true });
writeFileSync('supabase/migrations/202609030003_voice_room_status_realtime.sql', `create table if not exists public.voice_room_status (
  node_id text primary key check (node_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  participants integer not null default 0 check (participants >= 0),
  updated_at timestamptz not null default now()
);

alter table public.voice_room_status enable row level security;
revoke all on table public.voice_room_status from anon;
grant select on table public.voice_room_status to authenticated;
grant all on table public.voice_room_status to service_role;

drop policy if exists voice_room_status_authenticated_read on public.voice_room_status;
create policy voice_room_status_authenticated_read
on public.voice_room_status
for select
to authenticated
using (true);

drop policy if exists voice_room_status_broadcast_read on realtime.messages;
create policy voice_room_status_broadcast_read
on realtime.messages
for select
to authenticated
using (realtime.topic() = 'voice-room-status');

create or replace function public.broadcast_voice_room_status()
returns trigger
security definer
set search_path = ''
language plpgsql
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'nodeId', new.node_id,
      'participants', new.participants
    ),
    'voice_room_status_changed',
    'voice-room-status',
    true
  );
  return new;
end;
$$;

revoke execute on function public.broadcast_voice_room_status() from public, anon, authenticated;

drop trigger if exists broadcast_voice_room_status_trigger on public.voice_room_status;
create trigger broadcast_voice_room_status_trigger
after insert or update of participants on public.voice_room_status
for each row execute function public.broadcast_voice_room_status();
`);

mkdirSync('supabase', { recursive: true });
writeFileSync('supabase/config.toml', `[functions.livekit-webhook]\nverify_jwt = false\n`);

rmSync('scripts/apply-voice-event-push.mjs', { force: true });
rmSync('.github/workflows/apply-voice-event-push.yml', { force: true });
console.log('Applied voice-room event push implementation');
