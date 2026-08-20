export interface AuthSession { access_token: string; refresh_token?: string; expires_at?: number; }
export interface AuthConfig { url: string; publishableKey: string; storage?: Storage | null; fetch?: typeof fetch; }
export interface AccountProfile {
  username: string | null; displayName: string | null; avatarUrl: string | null; bio: string | null;
  myBalance: string; totalEnergy: string; accuracy: number;
}
export interface ProfileChanges { username: string; displayName?: string; avatarUrl?: string; bio?: string; }
export type PersonalMastery = 'none' | 'touched' | 'mastered';
export interface PersonalKnowledgeStateSnapshot {
  nodeId: string;
  mastery: PersonalMastery;
  version: number;
  updatedAt?: string;
}
export type PendingVoteSide = 'AGREE' | 'DISAGREE';
export type PendingVoteVerdict = 'PENDING' | 'CORRECT' | 'INCORRECT';
export type PendingVoteCloseReason = 'THRESHOLD' | 'TIMEOUT';
export interface PendingKnowledgeVoteSnapshot {
  nodeId: string;
  agreeCount: number;
  disagreeCount: number;
  requiredVotes: number;
  mySide: PendingVoteSide | null;
  myBalance?: string;
  roundId?: string;
  verdict: PendingVoteVerdict;
  closeReason: PendingVoteCloseReason | null;
  deadline?: string;
  closedAt?: string;
  policyVersion?: string;
}

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

  async currentUserId(): Promise<string> {
    const current = await this.publicSession();
    const response = await this.restRequest('/auth/v1/user', current, { method: 'GET' }) as Record<string, unknown>;
    if (typeof response.id !== 'string' || !response.id) throw new Error('服务端返回了无效用户身份');
    return response.id;
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

  /**
   * Upgrade the current anonymous Supabase user in place. The Edge Function keeps
   * the same auth.users.id, reserves the globally unique username, attaches the
   * password identity server-side, and returns a fresh permanent-user session.
   */
  async claimUsernamePassword(username: string, password: string): Promise<AccountProfile> {
    const current = await this.publicSession();
    const response = await this.functionRequest('username-password-auth', {
      action: 'claim', username, password,
    }, current);
    this.saveSession(sessionFromFunction(response));
    return this.getAccount();
  }

  /** Sign into an existing account from a different browser using only username + password. */
  async loginUsernamePassword(username: string, password: string): Promise<AccountProfile> {
    const response = await this.functionRequest('username-password-auth', {
      action: 'login', username, password,
    });
    this.saveSession(sessionFromFunction(response));
    return this.getAccount();
  }

  async getPersonalKnowledgeStates(): Promise<PersonalKnowledgeStateSnapshot[]> {
    const current = await this.publicSession();
    const response = await this.restRequest('/rest/v1/rpc/get_my_personal_knowledge_states', current, {
      method: 'POST', body: '{}',
    });
    if (!Array.isArray(response)) throw new Error('服务端返回了无效个人知识状态');
    return response.map(parsePersonalKnowledgeState);
  }

  async markKnowledgeTouched(nodeId: string): Promise<PersonalKnowledgeStateSnapshot> {
    const current = await this.publicSession();
    return parsePersonalKnowledgeState(await this.restRequest('/rest/v1/rpc/mark_my_knowledge_touched', current, {
      method: 'POST', body: JSON.stringify({ target_node_id: nodeId }),
    }));
  }

  async setPersonalKnowledgeState(nodeId: string, mastery: PersonalMastery): Promise<PersonalKnowledgeStateSnapshot> {
    const current = await this.publicSession();
    return parsePersonalKnowledgeState(await this.restRequest('/rest/v1/rpc/set_my_personal_knowledge_state', current, {
      method: 'POST', body: JSON.stringify({ target_node_id: nodeId, new_mastery: mastery }),
    }));
  }

  async mergePersonalKnowledgeStates(states: Array<Pick<PersonalKnowledgeStateSnapshot, 'nodeId' | 'mastery'>>): Promise<number> {
    const current = await this.publicSession();
    const response = await this.restRequest('/rest/v1/rpc/merge_my_personal_knowledge_states', current, {
      method: 'POST',
      body: JSON.stringify({ state_batch: states.map(state => ({ node_id: state.nodeId, mastery: state.mastery })) }),
    }) as Record<string, unknown>;
    const processed = Number(response.processed ?? 0);
    if (!Number.isSafeInteger(processed) || processed < 0) throw new Error('服务端返回了无效个人状态迁移数量');
    return processed;
  }

  async getPendingKnowledgeVote(nodeId: string): Promise<PendingKnowledgeVoteSnapshot> {
    const current = await this.publicSession();
    const response = await this.restRequest('/rest/v1/rpc/get_pending_knowledge_vote', current, {
      method: 'POST', body: JSON.stringify({ target_node_id: nodeId }),
    });
    return parsePendingKnowledgeVote(response, nodeId);
  }

  async castPendingKnowledgeVote(nodeId: string, side: PendingVoteSide): Promise<PendingKnowledgeVoteSnapshot> {
    if (side !== 'AGREE' && side !== 'DISAGREE') throw new Error('无效投票方向');
    const current = await this.publicSession();
    await this.restRequest('/rest/v1/rpc/ensure_anonymous_profile', current, { method: 'POST', body: '{}' });
    const response = await this.restRequest('/rest/v1/rpc/cast_pending_knowledge_vote', current, {
      method: 'POST',
      body: JSON.stringify({ target_node_id: nodeId, vote_side: side, operation_key: `pending-vote:${nodeId}` }),
    });
    return parsePendingKnowledgeVote(response, nodeId);
  }

  async settleExpiredPendingKnowledgeVotes(maxRounds = 50): Promise<number> {
    if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 200) throw new Error('无效结算批量大小');
    const current = await this.publicSession();
    const response = await this.restRequest('/rest/v1/rpc/settle_expired_pending_knowledge_votes', current, {
      method: 'POST', body: JSON.stringify({ max_rounds: maxRounds }),
    });
    const processed = Number(response);
    if (!Number.isSafeInteger(processed) || processed < 0) throw new Error('服务端返回了无效结算数量');
    return processed;
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
    if (!access_token) throw new Error('账户会话创建失败');
    const session = { access_token, refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : undefined,
      expires_at: Math.floor(Date.now() / 1000) + (typeof raw.expires_in === 'number' ? raw.expires_in : 3600) };
    try { this.storage?.setItem(GUEST_SESSION_KEY, JSON.stringify(session)); } catch { /* ephemeral session */ }
    return session;
  }

  private async authRequest(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await parseResponse(await this.request(`${this.baseUrl()}${path}`, { ...init, headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json', ...init.headers } }));
    return response as Record<string, unknown>;
  }

  private async functionRequest(name: string, body: Record<string, unknown>, session?: AuthSession): Promise<Record<string, unknown>> {
    const response = await parseResponse(await this.request(`${this.baseUrl()}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        apikey: this.config.publishableKey,
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(body),
    }));
    return response as Record<string, unknown>;
  }

  private async restRequest(path: string, session: AuthSession, init: RequestInit): Promise<unknown> {
    return parseResponse(await this.request(`${this.baseUrl()}${path}`, { ...init, headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...init.headers } }));
  }

  private baseUrl(): string { return this.config.url.replace(/\/$/, ''); }
}

async function parseResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const record = body as Record<string, unknown>;
    const message = typeof record.error === 'string' ? record.error
      : typeof record.message === 'string' ? record.message
      : `请求失败 (${response.status})`;
    throw new Error(message);
  }
  return body;
}

function sessionFromFunction(value: Record<string, unknown>): Record<string, unknown> {
  const session = value.session;
  if (!session || typeof session !== 'object') throw new Error('服务端返回了无效账户会话');
  return session as Record<string, unknown>;
}

function parsePersonalKnowledgeState(value: unknown): PersonalKnowledgeStateSnapshot {
  const response = value as Record<string, unknown>;
  const nodeId = typeof response.node_id === 'string' ? response.node_id : '';
  const mastery = response.mastery;
  const version = Number(response.version);
  if (!nodeId || (mastery !== 'none' && mastery !== 'touched' && mastery !== 'mastered') || !Number.isSafeInteger(version) || version < 1) {
    throw new Error('服务端返回了无效个人知识状态');
  }
  return {
    nodeId,
    mastery,
    version,
    updatedAt: optionalString(response.updated_at),
  };
}

function exactEnergy(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '0');
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) throw new Error('服务端返回了无效能量精度');
  const [whole, fraction = ''] = text.split('.'); return `${whole}.${fraction.padEnd(6, '0')}`;
}

function countValue(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`服务端返回了无效${field}`);
  return number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parsePendingKnowledgeVote(value: unknown, nodeId: string): PendingKnowledgeVoteSnapshot {
  const response = value as Record<string, unknown>;
  const side = response.my_side;
  if (side !== null && side !== undefined && side !== 'AGREE' && side !== 'DISAGREE') throw new Error('服务端返回了无效投票状态');
  const responseNodeId = typeof response.node_id === 'string' ? response.node_id : nodeId;
  if (responseNodeId !== nodeId) throw new Error('投票响应节点不匹配');
  const verdict = response.verdict ?? 'PENDING';
  if (verdict !== 'PENDING' && verdict !== 'CORRECT' && verdict !== 'INCORRECT') throw new Error('服务端返回了无效结算状态');
  const closeReason = response.close_reason;
  if (closeReason !== null && closeReason !== undefined && closeReason !== 'THRESHOLD' && closeReason !== 'TIMEOUT') throw new Error('服务端返回了无效结算原因');
  return {
    nodeId,
    agreeCount: countValue(response.agree_count, '赞成票数'),
    disagreeCount: countValue(response.disagree_count, '反对票数'),
    requiredVotes: countValue(response.required_votes, '所需票数'),
    mySide: side === 'AGREE' || side === 'DISAGREE' ? side : null,
    myBalance: response.my_balance === null || response.my_balance === undefined ? undefined : exactEnergy(response.my_balance),
    roundId: optionalString(response.round_id),
    verdict,
    closeReason: closeReason === 'THRESHOLD' || closeReason === 'TIMEOUT' ? closeReason : null,
    deadline: optionalString(response.deadline),
    closedAt: optionalString(response.closed_at),
    policyVersion: optionalString(response.policy_version),
  };
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
