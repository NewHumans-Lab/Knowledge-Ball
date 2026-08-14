export interface AuthSession { access_token: string; refresh_token?: string; expires_at?: number; }
export interface AuthConfig { url: string; publishableKey: string; storage?: Storage | null; fetch?: typeof fetch; }
export interface AccountProfile {
  username: string | null; displayName: string | null; avatarUrl: string | null; bio: string | null;
  myBalance: string; totalEnergy: string; accuracy: number;
}
export interface ProfileChanges { username: string; displayName?: string; avatarUrl?: string; bio?: string; }

export const GUEST_SESSION_KEY = 'knowledge-ball.supabase-guest-session.v1';
const LEGACY_SESSION_KEY = 'knowledge-ball.supabase-session.v1';

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export class KnowledgeBallAuthClient {
  private readonly request: typeof fetch;
  private readonly storage: Storage | null;

  constructor(private readonly config: AuthConfig) {
    this.request = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.storage = config.storage === undefined ? browserStorage() : config.storage;
  }

  isConfigured(): boolean { return Boolean(this.config.url && this.config.publishableKey); }

  async session(): Promise<AuthSession> { return this.publicSession(); }

  async publicSession(): Promise<AuthSession> {
    const saved = this.readSession();
    if (saved?.access_token && (!saved.expires_at || saved.expires_at > Date.now() / 1000 + 60)) return saved;
    if (saved?.refresh_token) {
      try { return await this.refresh(saved.refresh_token); } catch { /* replace expired anonymous session */ }
    }
    return this.createSession();
  }

  async getAccount(): Promise<AccountProfile> {
    const current = await this.publicSession();
    await this.restRequest('/rest/v1/rpc/ensure_anonymous_profile', current, { method: 'POST', body: '{}' });
    return this.profileFrom(await this.restRequest('/rest/v1/rpc/get_my_account', current, { method: 'POST', body: '{}' }));
  }

  async updateProfile(changes: ProfileChanges): Promise<AccountProfile> {
    const current = await this.publicSession();
    await this.restRequest('/rest/v1/rpc/ensure_anonymous_profile', current, { method: 'POST', body: '{}' });
    const response = await this.restRequest('/rest/v1/rpc/update_my_profile', current, {
      method: 'POST',
      body: JSON.stringify({ new_username: changes.username, new_display_name: changes.displayName ?? null, new_avatar_url: changes.avatarUrl ?? null, new_bio: changes.bio ?? null }),
    });
    return this.profileFrom(response);
  }

  private profileFrom(value: unknown): AccountProfile {
    const response = value as Record<string, unknown>;
    return {
      username: typeof response.username === 'string' ? response.username : null,
      displayName: typeof response.display_name === 'string' ? response.display_name : null,
      avatarUrl: typeof response.avatar_url === 'string' ? response.avatar_url : null,
      bio: typeof response.bio === 'string' ? response.bio : null,
      myBalance: exactEnergy(response.my_balance), totalEnergy: exactEnergy(response.total_energy),
      accuracy: typeof response.accuracy === 'number' ? response.accuracy : 0,
    };
  }

  private readSession(): AuthSession | null {
    try {
      const parsed = JSON.parse(this.storage?.getItem(GUEST_SESSION_KEY) ?? this.storage?.getItem(LEGACY_SESSION_KEY) ?? 'null');
      if (parsed?.access_token) {
        this.storage?.setItem(GUEST_SESSION_KEY, JSON.stringify(parsed));
        this.storage?.removeItem(LEGACY_SESSION_KEY);
        return parsed;
      }
      return null;
    } catch { return null; }
  }

  private async createSession(): Promise<AuthSession> {
    const response = await this.authRequest('/auth/v1/signup', { method: 'POST', body: '{}' });
    return this.saveSession(response);
  }

  private async refresh(refreshToken: string): Promise<AuthSession> {
    const response = await this.authRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
    return this.saveSession(response);
  }

  private saveSession(raw: Record<string, unknown>): AuthSession {
    const access_token = typeof raw.access_token === 'string' ? raw.access_token : '';
    if (!access_token) throw new Error('匿名参与会话创建失败');
    const session = { access_token, refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
      expires_at: Math.floor(Date.now() / 1000) + (typeof raw.expires_in === 'number' ? raw.expires_in : 3600) };
    try { this.storage?.setItem(GUEST_SESSION_KEY, JSON.stringify(session)); } catch { /* ephemeral session */ }
    return session;
  }

  private async authRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    return parseResponse(await this.request(`${this.baseUrl()}${path}`, { ...init, headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...init.headers } }));
  }

  private async restRequest(path: string, session: AuthSession, init: RequestInit): Promise<unknown> {
    return parseResponse(await this.request(`${this.baseUrl()}${path}`, { ...init, headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...init.headers } }));
  }

  private baseUrl(): string { return this.config.url.replace(/\/$/, ''); }
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `请求失败 (${response.status})`);
  return body;
}

function exactEnergy(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '0');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('服务端返回了无效能量精度');
  const [whole, fraction = ''] = text.split('.'); return `${whole}.${fraction.padEnd(6, '0')}`;
}
export function compactEnergy(value: string): string {
  if (!/^-?\d+\.\d{6}$/.test(value)) return '—';
  const whole = value.split('.')[0];
  return whole === '-0' ? '0' : whole;
}

export function createProductionAuthClient(): KnowledgeBallAuthClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim(); const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? new KnowledgeBallAuthClient({ url, publishableKey }) : null;
}
