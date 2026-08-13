export interface AuthSession {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface AuthConfig {
  url: string;
  publishableKey: string;
  storage?: Storage | null;
  fetch?: typeof fetch;
}

export interface EnergyBalances {
  myBalance: number;
  systemBalance: number;
}

export interface SignUpResult {
  verificationRequired: boolean;
}

export const SESSION_KEY = 'knowledge-ball.supabase-session.v1';
export const GUEST_SESSION_KEY = 'knowledge-ball.supabase-guest-session.v1';

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    if (typeof globalThis.atob !== 'function') return null;
    const decoded = globalThis.atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function sessionHasVerifiedPhone(session: AuthSession | null): boolean {
  if (!session?.access_token) return false;
  const claims = parseJwtPayload(session.access_token);
  if (!claims) return false;
  return typeof claims.phone === 'string' && claims.phone.length > 0 && claims.is_anonymous !== true;
}

export class KnowledgeBallAuthClient {
  private readonly request: typeof fetch;
  private readonly storage: Storage | null;

  constructor(private readonly config: AuthConfig) {
    this.request = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.storage = config.storage === undefined ? browserStorage() : config.storage;
  }

  isConfigured(): boolean {
    return Boolean(this.config.url && this.config.publishableKey);
  }

  readStoredSession(): AuthSession | null {
    try {
      const parsed = JSON.parse(this.storage?.getItem(SESSION_KEY) ?? 'null') as AuthSession | null;
      return parsed?.access_token ? parsed : null;
    } catch {
      return null;
    }
  }

  hasVerifiedIdentity(): boolean {
    const saved = this.readStoredSession();
    if (!sessionHasVerifiedPhone(saved)) return false;
    if (!saved?.expires_at || saved.expires_at > Date.now() / 1000 + 60) return true;
    return Boolean(saved.refresh_token);
  }

  async session(): Promise<AuthSession | null> {
    const saved = this.readStoredSession();
    if (!saved || !sessionHasVerifiedPhone(saved)) return null;
    if (!saved.expires_at || saved.expires_at > Date.now() / 1000 + 60) return saved;
    if (!saved.refresh_token) return null;
    try {
      return await this.refresh(saved.refresh_token);
    } catch {
      this.clearSession();
      return null;
    }
  }

  async publicSession(): Promise<AuthSession> {
    const verified = await this.session();
    if (verified) return verified;
    const existing = this.readGuestSession();
    if (existing?.access_token && (!existing.expires_at || existing.expires_at > Date.now() / 1000 + 60)) return existing;
    if (existing?.refresh_token) {
      try { return await this.refreshGuest(existing.refresh_token); } catch { /* create a new guest below */ }
    }
    return this.createGuestSession();
  }

  async signIn(phone: string, password: string): Promise<void> {
    const normalizedPhone = normalizePhoneInput(phone);
    const response = await this.authRequest('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ phone: normalizedPhone, password }),
    });
    this.saveSession(response);
    await this.ensureProfile(normalizedPhone);
  }

  async signUp(phone: string, password: string): Promise<SignUpResult> {
    const normalizedPhone = normalizePhoneInput(phone);
    const response = await this.authRequest('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ phone: normalizedPhone, password }),
    });
    if (typeof response.access_token === 'string' && response.access_token) {
      this.saveSession(response);
      await this.ensureProfile(normalizedPhone);
      return { verificationRequired: false };
    }
    return { verificationRequired: true };
  }

  async verifySms(phone: string, token: string): Promise<void> {
    const normalizedPhone = normalizePhoneInput(phone);
    const response = await this.authRequest('/auth/v1/verify', {
      method: 'POST',
      body: JSON.stringify({ type: 'sms', phone: normalizedPhone, token: token.trim() }),
    });
    this.saveSession(response);
    await this.ensureProfile(normalizedPhone);
  }

  async signOut(): Promise<void> {
    const current = this.readStoredSession();
    this.clearSession();
    if (!current?.access_token) return;
    try {
      await this.request(`${this.baseUrl()}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: this.config.publishableKey,
          Authorization: `Bearer ${current.access_token}`,
        },
      });
    } catch {
      // Local sign-out is authoritative for this client.
    }
  }

  async getBalances(): Promise<EnergyBalances> {
    const current = await this.session();
    if (!current) throw new Error('请先登录或注册');
    const response = await this.restRequest('/rest/v1/rpc/get_energy_balances', current, {
      method: 'POST',
      body: '{}',
    }) as { my_balance?: number; system_balance?: number };
    return {
      myBalance: Number(response.my_balance ?? 0),
      systemBalance: Number(response.system_balance ?? 0),
    };
  }

  private async ensureProfile(phone: string): Promise<void> {
    const current = await this.session();
    if (!current) throw new Error('登录会话无效');
    const inviter = readInviterFromUrl();
    await this.restRequest('/rest/v1/rpc/register_verified_phone', current, {
      method: 'POST',
      body: JSON.stringify({
        verified_phone: phone,
        inviter,
        operation_key: `register:${crypto.randomUUID()}`,
      }),
    });
  }

  private readGuestSession(): AuthSession | null {
    try {
      const parsed = JSON.parse(this.storage?.getItem(GUEST_SESSION_KEY) ?? 'null') as AuthSession | null;
      if (parsed?.access_token) return parsed;
      const legacy = this.readStoredSession();
      if (legacy?.access_token && !sessionHasVerifiedPhone(legacy)) {
        this.storage?.setItem(GUEST_SESSION_KEY, JSON.stringify(legacy));
        this.storage?.removeItem(SESSION_KEY);
        return legacy;
      }
    } catch { /* ignore unavailable storage */ }
    return null;
  }

  private async createGuestSession(): Promise<AuthSession> {
    const response = await this.authRequest('/auth/v1/signup', { method: 'POST', body: '{}' });
    const accessToken = typeof response.access_token === 'string' ? response.access_token : '';
    if (!accessToken) throw new Error('匿名浏览会话创建失败');
    const expiresIn = typeof response.expires_in === 'number' ? response.expires_in : 3600;
    return this.saveGuestSession({
      access_token: accessToken,
      refresh_token: typeof response.refresh_token === 'string' ? response.refresh_token : undefined,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    });
  }

  private async refreshGuest(refreshToken: string): Promise<AuthSession> {
    const response = await this.authRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const accessToken = typeof response.access_token === 'string' ? response.access_token : '';
    if (!accessToken) throw new Error('匿名浏览会话刷新失败');
    return this.saveGuestSession({
      access_token: accessToken,
      refresh_token: typeof response.refresh_token === 'string' ? response.refresh_token : refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + (typeof response.expires_in === 'number' ? response.expires_in : 3600),
    });
  }

  private saveGuestSession(session: AuthSession): AuthSession {
    try { this.storage?.setItem(GUEST_SESSION_KEY, JSON.stringify(session)); } catch { /* ephemeral guest */ }
    return session;
  }

  private async refresh(refreshToken: string): Promise<AuthSession> {
    const response = await this.authRequest('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    return this.saveSession(response);
  }

  private async authRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.request(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        apikey: this.config.publishableKey,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    return parseResponse(response);
  }

  private async restRequest(path: string, session: AuthSession, init: RequestInit): Promise<unknown> {
    const response = await this.request(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        apikey: this.config.publishableKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    return parseResponse(response);
  }

  private saveSession(raw: Record<string, unknown>): AuthSession {
    const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
    if (!accessToken) throw new Error('认证成功但没有返回有效会话');
    const expiresIn = typeof raw.expires_in === 'number' ? raw.expires_in : 3600;
    const session: AuthSession = {
      access_token: accessToken,
      refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    };
    if (!sessionHasVerifiedPhone(session)) throw new Error('必须使用已验证手机号登录');
    try { this.storage?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* memory-only session */ }
    return session;
  }

  private clearSession(): void {
    try { this.storage?.removeItem(SESSION_KEY); } catch { /* ignore unavailable storage */ }
  }

  private baseUrl(): string {
    return this.config.url.replace(/\/$/, '');
  }
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof body.msg === 'string'
      ? body.msg
      : typeof body.message === 'string'
        ? body.message
        : typeof body.error_description === 'string'
          ? body.error_description
          : `请求失败 (${response.status})`;
    throw new Error(message);
  }
  return body;
}

export function normalizePhoneInput(phone: string): string {
  const normalized = phone.trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new Error('手机号必须使用国际格式，例如 +8613812345678');
  }
  return normalized;
}

function readInviterFromUrl(): string | null {
  try {
    const value = new URLSearchParams(window.location.search).get('ref');
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function createProductionAuthClient(): KnowledgeBallAuthClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? new KnowledgeBallAuthClient({ url, publishableKey }) : null;
}
