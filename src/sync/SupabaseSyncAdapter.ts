import { isPublicKnowledgeEvent, type DomainEvent, type PublicKnowledgeEvent } from '../event/Event';
import { RemoteHeadConflictError, type PushResult, type SyncAdapter, type SyncBatch } from './SyncAdapter';
import type { StorageLike } from '../persistence/KnowledgePersistence';

interface SupabaseConfig { url: string; publishableKey: string; pageSize?: number; storage?: StorageLike | null; fetch?: typeof fetch; }
interface Session { access_token: string; expires_at?: number; }
interface EventRow { sequence: number; envelope: DomainEvent; }
const SESSION_KEY = 'knowledge-ball.supabase-session.v1';

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export class SupabaseSyncAdapter implements SyncAdapter {
  private readonly request: typeof fetch;
  private readonly pageSize: number;
  constructor(private readonly config: SupabaseConfig) {
    this.request = config.fetch ?? fetch;
    this.pageSize = config.pageSize ?? 200;
  }

  async pull(cursor = '0'): Promise<SyncBatch> {
    let head = Number(cursor);
    const events: PublicKnowledgeEvent[] = [];
    while (true) {
      const params = new URLSearchParams({
        select: 'sequence,envelope', sequence: `gt.${head}`, order: 'sequence.asc', limit: String(this.pageSize),
      });
      const rows = await this.api<EventRow[]>(`/rest/v1/public_knowledge_events?${params}`);
      for (const row of rows) {
        head = Math.max(head, row.sequence);
        if (isPublicKnowledgeEvent(row.envelope)) events.push(row.envelope);
      }
      if (rows.length < this.pageSize) break;
    }
    return { events, cursor: String(head) };
  }

  async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    if (events.some(event => !isPublicKnowledgeEvent(event))) throw new Error('Personal events cannot enter the public stream');
    const envelopes = events.map(({ seq: _localSequence, ...event }) => event);
    try {
      const result = await this.api<{ head: number; acknowledged_event_ids: string[] }>('/rest/v1/rpc/append_public_knowledge_events', {
        method: 'POST', body: JSON.stringify({ expected_head: Number(expectedCursor), event_batch: envelopes }),
      });
      return { cursor: String(result.head), acknowledgedEventIds: result.acknowledged_event_ids };
    } catch (error) {
      if (error instanceof SupabaseApiError && error.code === 'KB409') {
        throw new RemoteHeadConflictError(String(error.details?.current_head ?? expectedCursor));
      }
      throw error;
    }
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const session = await this.session();
    const response = await this.request(`${this.config.url.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new SupabaseApiError(response.status, body.code, body.message, parseDetails(body.details));
    }
    return response.json() as Promise<T>;
  }

  private async session(): Promise<Session> {
    const storage = this.config.storage === undefined ? browserStorage() : this.config.storage;
    try {
      const saved = JSON.parse(storage?.getItem(SESSION_KEY) ?? 'null') as Session | null;
      if (saved?.access_token && (!saved.expires_at || saved.expires_at > Date.now() / 1000 + 60)) return saved;
    } catch { /* create a fresh anonymous identity */ }

    const response = await this.request(`${this.config.url.replace(/\/$/, '')}/auth/v1/signup`, {
      method: 'POST', headers: { apikey: this.config.publishableKey, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!response.ok) throw new Error(`Supabase anonymous authentication failed (${response.status})`);
    const result = await response.json() as { access_token?: string; expires_in?: number };
    if (!result.access_token) throw new Error('Supabase anonymous authentication returned no access token');
    const session = { access_token: result.access_token, expires_at: Math.floor(Date.now() / 1000) + (result.expires_in ?? 3600) };
    try { storage?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ephemeral session remains usable */ }
    return session;
  }
}

class SupabaseApiError extends Error {
  constructor(readonly status: number, readonly code?: string, message?: string, readonly details?: Record<string, unknown>) {
    super(message ?? `Supabase request failed (${status})`);
  }
}
function parseDetails(details: unknown): Record<string, unknown> | undefined {
  if (typeof details !== 'string') return details && typeof details === 'object' ? details as Record<string, unknown> : undefined;
  try { return JSON.parse(details) as Record<string, unknown>; } catch { return undefined; }
}

export function createProductionSyncAdapter(): SupabaseSyncAdapter | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? new SupabaseSyncAdapter({ url, publishableKey }) : null;
}
