import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { AccessToken, RoomServiceClient, TrackSource } from 'npm:livekit-server-sdk@2.18.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROOM_PREFIX = 'knowledge:';
const SPEAKING_TTL_MS = 4500;
const NODE_CACHE_TTL_MS = 10_000;
const EVENT_PAGE_SIZE = 500;

type PublicEventRow = {
  sequence?: number;
  envelope?: Record<string, unknown>;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function readNamedKey(name: 'SUPABASE_PUBLISHABLE_KEYS', legacy: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === 'string' && value) return value;
    } catch { /* fall through during Supabase key migration */ }
  }
  return Deno.env.get(legacy) ?? '';
}

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PUBLISHABLE_KEY = readNamedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const LIVEKIT_URL = Deno.env.get('LIVEKIT_URL') ?? '';
const LIVEKIT_API_KEY = Deno.env.get('LIVEKIT_API_KEY') ?? '';
const LIVEKIT_API_SECRET = Deno.env.get('LIVEKIT_API_SECRET') ?? '';

function liveKitHttpUrl(value: string): string {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol === 'ws:') url.protocol = 'http:';
  return url.toString().replace(/\/$/, '');
}

const roomService = LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
  ? new RoomServiceClient(liveKitHttpUrl(LIVEKIT_URL), LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
  : null;

function nodeIdValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function roomName(nodeId: string): string { return `${ROOM_PREFIX}${nodeId}`; }

async function currentUser(accessToken: string): Promise<{ id: string }> {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof body.id !== 'string' || !body.id) {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  }
  return { id: body.id };
}

function speakingUntil(metadata: string | undefined): number {
  if (!metadata) return 0;
  try {
    const value = JSON.parse(metadata) as Record<string, unknown>;
    const until = Number(value.speakingUntil);
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

function createdNodeIds(envelope: Record<string, unknown> | undefined): string[] {
  if (!envelope) return [];
  const type = envelope.type;
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;

  if (type === 'NodeCreated') {
    const nodeId = nodeIdValue(record.nodeId);
    return nodeId ? [nodeId] : [];
  }

  if (type !== 'KnowledgeAdded') return [];
  const edit = record.edit;
  if (!edit || typeof edit !== 'object') return [];
  const e = edit as Record<string, unknown>;
  if (e.kind !== 'add') return [];

  const ids: string[] = [];
  const pushId = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const id = nodeIdValue((value as Record<string, unknown>).id);
    if (id) ids.push(id);
  };

  if (e.mode === 'atomic') {
    pushId(e.node);
  } else if (e.mode === 'theory') {
    pushId(e.reasoning);
    pushId(e.conclusion);
  } else if (e.mode === 'reasoning-link') {
    pushId(e.reasoning);
  }
  return ids;
}

let cachedNodeIds = new Set<string>();
let nodeCacheAt = 0;
let nodeCacheRefresh: Promise<Set<string>> | null = null;

async function fetchDeclaredNodeIds(accessToken: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      select: 'sequence,envelope',
      event_type: 'in.(NodeCreated,KnowledgeAdded)',
      order: 'sequence.asc',
      limit: String(EVENT_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/public_knowledge_events?${params}`, {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      throw Object.assign(new Error('knowledge node validation failed'), { status: 503 });
    }
    const rows = await response.json().catch(() => []) as PublicEventRow[];
    if (!Array.isArray(rows)) {
      throw Object.assign(new Error('knowledge node validation failed'), { status: 503 });
    }
    for (const row of rows) {
      for (const id of createdNodeIds(row.envelope)) ids.add(id);
    }
    if (rows.length < EVENT_PAGE_SIZE) break;
    offset += rows.length;
  }

  cachedNodeIds = ids;
  nodeCacheAt = Date.now();
  return ids;
}

async function declaredNodeIds(accessToken: string): Promise<Set<string>> {
  if (Date.now() - nodeCacheAt < NODE_CACHE_TTL_MS) return cachedNodeIds;
  if (!nodeCacheRefresh) {
    nodeCacheRefresh = fetchDeclaredNodeIds(accessToken).finally(() => {
      nodeCacheRefresh = null;
    });
  }
  return nodeCacheRefresh;
}

async function requireDeclaredNode(nodeId: string, accessToken: string): Promise<void> {
  const ids = await declaredNodeIds(accessToken);
  if (!ids.has(nodeId)) throw Object.assign(new Error('unknown knowledge node'), { status: 404 });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) return json(503, { error: 'Supabase auth is not configured' });
  if (!roomService || !LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return json(503, { error: 'LiveKit voice is not configured' });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!accessToken) return json(401, { error: 'authentication required' });

  try {
    const user = await currentUser(accessToken);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action;

    if (action === 'status') {
      const now = Date.now();
      const rooms = (await roomService.listRooms())
        .filter(room => room.name.startsWith(ROOM_PREFIX) && Number(room.numParticipants) > 0)
        .map(room => ({
          nodeId: room.name.slice(ROOM_PREFIX.length),
          participants: Number(room.numParticipants),
          speaking: speakingUntil(room.metadata) > now,
        }));
      return json(200, { rooms });
    }

    const nodeId = nodeIdValue(body.nodeId);
    if (!nodeId) return json(400, { error: 'invalid node id' });
    const targetRoom = roomName(nodeId);

    if (action === 'join') {
      await requireDeclaredNode(nodeId, accessToken);
      const participantIdentity = `${user.id}:${crypto.randomUUID()}`;
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: participantIdentity,
        ttl: '15m',
      });
      token.addGrant({
        roomJoin: true,
        room: targetRoom,
        canSubscribe: true,
        canPublish: true,
        canPublishData: false,
        canPublishSources: [TrackSource.MICROPHONE],
        canUpdateOwnMetadata: false,
      });
      return json(200, {
        nodeId,
        url: LIVEKIT_URL,
        participantIdentity,
        token: await token.toJwt(),
      });
    }

    if (action === 'speaking') {
      const participantIdentity = typeof body.participantIdentity === 'string' ? body.participantIdentity : '';
      if (!participantIdentity.startsWith(`${user.id}:`)) {
        return json(403, { error: 'participant identity mismatch' });
      }
      await roomService.getParticipant(targetRoom, participantIdentity);
      await roomService.updateRoomMetadata(targetRoom, JSON.stringify({
        kind: 'knowledge-node-voice',
        nodeId,
        speakingUntil: Date.now() + SPEAKING_TTL_MS,
      }));
      return json(200, { ok: true });
    }

    return json(400, { error: 'invalid action' });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    if (status === 401) return json(401, { error: 'authentication failed' });
    if (status === 404) return json(404, { error: 'knowledge node does not exist' });
    if (status === 503) return json(503, { error: 'knowledge node validation unavailable' });
    console.error('[livekit-voice]', error);
    return json(500, { error: 'voice service request failed' });
  }
});