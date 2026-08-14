import { isCanonicalPublicKnowledgeEvent, isPublicKnowledgeEvent, type DomainEvent, type PublicKnowledgeEvent } from '../event/Event';
import { KnowledgeBallAuthClient } from '../auth/AuthClient';
import { RemoteHeadConflictError, type PushResult, type SyncAdapter, type SyncBatch } from './SyncAdapter';
import type { StorageLike } from '../persistence/KnowledgePersistence';

interface SupabaseConfig { url: string; publishableKey: string; pageSize?: number; storage?: StorageLike | null; fetch?: typeof fetch; }
interface EventRow { sequence: number; envelope: DomainEvent; }

export class SupabaseSyncAdapter implements SyncAdapter {
  private readonly request: typeof fetch;
  private readonly pageSize: number;
  private readonly auth: KnowledgeBallAuthClient;

  constructor(private readonly config: SupabaseConfig) {
    this.request = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.pageSize = config.pageSize ?? 200;
    this.auth = new KnowledgeBallAuthClient({ url: config.url, publishableKey: config.publishableKey, storage: config.storage as Storage | null | undefined, fetch: this.request });
  }

  async pull(cursor = '0'): Promise<SyncBatch> {
    let head = Number(cursor);
    const events: PublicKnowledgeEvent[] = [];
    while (true) {
      const params = new URLSearchParams({ select: 'sequence,envelope', sequence: `gt.${head}`, order: 'sequence.asc', limit: String(this.pageSize) });
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
    if (events.some(event => !isCanonicalPublicKnowledgeEvent(event))) throw new Error('Only canonical public knowledge events can enter the public stream');
    const envelopes = events.map(({ seq: _localSequence, ...event }) => event);
    try {
      const result = await this.api<{ head: number; acknowledged_event_ids: string[] }>('/rest/v1/rpc/append_public_knowledge_events', { method: 'POST', body: JSON.stringify({ expected_head: Number(expectedCursor), event_batch: envelopes }) });
      return { cursor: String(result.head), acknowledgedEventIds: result.acknowledged_event_ids };
    } catch (error) {
      if (error instanceof SupabaseApiError && error.code === 'KB409') throw new RemoteHeadConflictError(String(error.details?.current_head ?? expectedCursor));
      throw error;
    }
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const session = await this.auth.publicSession();
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
}

class SupabaseApiError extends Error {
  constructor(readonly status: number, readonly code?: string, message?: string, readonly details?: Record<string, unknown>) { super(message ?? `Supabase request failed (${status})`); }
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
