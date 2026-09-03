import { RoomServiceClient, WebhookReceiver } from 'npm:livekit-server-sdk@2.18.0';

const ROOM_PREFIX = 'knowledge:';
const NODE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requiredEnv(name) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeLiveKitUrl(value) {
  if (value.startsWith('wss://')) return `https://${value.slice('wss://'.length)}`;
  if (value.startsWith('ws://')) return `http://${value.slice('ws://'.length)}`;
  return value.replace(/\/$/, '');
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
  const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const secretKey = readSecretKey();
  const headers = {
    apikey: secretKey,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  if (!secretKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secretKey}`;
  const response = await fetch(`${supabaseUrl}/rest/v1/voice_room_status?on_conflict=node_id`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ node_id: nodeId, participants, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`voice_room_status write failed: ${response.status} ${await response.text()}`);
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
