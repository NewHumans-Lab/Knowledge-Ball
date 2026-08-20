import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function readNamedKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS', legacy: string): string {
  const raw = Deno.env.get(name);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const value = parsed.default;
      if (typeof value === 'string' && value) return value;
    } catch { /* fall through to the legacy key during the 2026 migration window */ }
  }
  return Deno.env.get(legacy) ?? '';
}

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const PUBLISHABLE_KEY = readNamedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SECRET_KEY = readNamedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const LEGACY_SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(normalized) ? normalized : null;
}

function passwordValue(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null;
  return value;
}

function internalEmail(userId: string): string {
  return `kb-${userId.replaceAll('-', '')}@identity.invalid`;
}

function secretHeaders(extra: Record<string, string> = {}): HeadersInit {
  // New sb_secret_* keys belong on apikey only. The legacy service_role key is a
  // JWT and remains accepted through end-2026, so include Authorization only for it.
  const headers: Record<string, string> = {
    apikey: SECRET_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
  if (SECRET_KEY && SECRET_KEY === LEGACY_SECRET) headers.Authorization = `Bearer ${SECRET_KEY}`;
  return headers;
}

async function parse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(typeof body.message === 'string' ? body.message : `request failed (${response.status})`) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = typeof body.code === 'string' ? body.code : undefined;
    throw error;
  }
  return body;
}

async function currentUser(accessToken: string): Promise<{ id: string }> {
  const body = await parse(await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
  }));
  if (typeof body.id !== 'string' || !body.id) throw new Error('invalid authenticated user');
  return { id: body.id };
}

async function reserveUsername(accessToken: string, username: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reserve_my_username`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ new_username: username }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : '';
    if (code === '23505') throw Object.assign(new Error('username already in use'), { status: 409 });
    throw Object.assign(new Error(typeof body.message === 'string' ? body.message : 'username reservation failed'), { status: response.status });
  }
}

async function setPasswordIdentity(userId: string, password: string): Promise<void> {
  await parse(await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: secretHeaders(),
    body: JSON.stringify({
      email: internalEmail(userId),
      password,
      email_confirm: true,
    }),
  }));
}

async function setLoginEnabled(userId: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_ball_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: secretHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ password_login_enabled: true, password_login_updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw Object.assign(new Error('failed to activate username login'), { status: response.status });
}

async function lookupUserId(username: string): Promise<string | null> {
  const params = new URLSearchParams({
    select: 'user_id',
    username: `eq.${username}`,
    password_login_enabled: 'is.true',
    limit: '1',
  });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_ball_profiles?${params}`, {
    headers: secretHeaders(),
  });
  const rows = await parse(response) as unknown as Array<Record<string, unknown>>;
  const id = Array.isArray(rows) && typeof rows[0]?.user_id === 'string' ? rows[0].user_id : null;
  return id;
}

async function passwordSession(userId: string | null, password: string): Promise<Record<string, unknown>> {
  // Unknown usernames still perform the same password grant against a reserved
  // non-existent identity so callers receive one generic credential error.
  const email = userId ? internalEmail(userId) : 'kb-00000000000000000000000000000000@identity.invalid';
  return parse(await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }));
}

function sessionPayload(raw: Record<string, unknown>) {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : '';
  const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 3600;
  if (!accessToken || !refreshToken) throw new Error('invalid auth session');
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) return json(503, { error: 'auth service is not configured' });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const username = normalizeUsername(body.username);
  const password = passwordValue(body.password);
  if (!username) return json(400, { error: '用户名必须是 3-24 位小写字母、数字或下划线' });
  if (!password) return json(400, { error: '请输入密码' });

  try {
    if (action === 'claim') {
      const authorization = req.headers.get('Authorization') ?? '';
      const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!accessToken) return json(401, { error: '请先打开当前匿名账户再设置用户名和密码' });

      const user = await currentUser(accessToken);
      await reserveUsername(accessToken, username);
      await setPasswordIdentity(user.id, password);
      await setLoginEnabled(user.id);
      const session = sessionPayload(await passwordSession(user.id, password));
      return json(200, { ok: true, username, session });
    }

    if (action === 'login') {
      const userId = await lookupUserId(username);
      try {
        const session = sessionPayload(await passwordSession(userId, password));
        return json(200, { ok: true, username, session });
      } catch {
        return json(401, { error: '用户名或密码错误' });
      }
    }

    return json(400, { error: 'invalid action' });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    if (status === 409) return json(409, { error: '用户名已被使用' });
    if (status === 400 || status === 422) return json(400, { error: '密码不符合当前账户安全要求' });
    console.error('[username-password-auth]', error);
    return json(status === 401 ? 401 : 500, { error: status === 401 ? '身份验证失败' : '账户设置失败，请稍后重试' });
  }
});
