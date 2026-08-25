import { isCanonicalPublicKnowledgeEvent, isPublicKnowledgeEvent, type DomainEvent, type PublicKnowledgeEvent } from '../event/Event';
import { KnowledgeBallAuthClient } from '../auth/AuthClient';
import { RemoteHeadConflictError, type PushResult, type SyncAdapter, type SyncBatch } from './SyncAdapter';
import type { StorageLike } from '../persistence/KnowledgePersistence';

interface SupabaseConfig { url: string; publishableKey: string; pageSize?: number; storage?: StorageLike | null; fetch?: typeof fetch; }
interface EventRow { sequence: number; envelope: DomainEvent; actor_id?: string | null; created_at?: string | null; }
interface ContributorRow { actor_id?: string | null; contributor?: string | null; }
interface NodeCreationMetadata { actorId: string; createdAt: string; }
export interface NodePresentationMetadata { contributor: string; createdAt: string; actorId: string; }

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function createdNodeIdsFromEvent(event: DomainEvent): string[] {
  if (event.type === 'NodeCreated') return event.payload.nodeId ? [event.payload.nodeId] : [];
  if (event.type !== 'KnowledgeAdded' || event.payload.edit.kind !== 'add') return [];
  const edit = event.payload.edit;
  if (edit.mode === 'atomic') return edit.node.id ? [edit.node.id] : [];
  if (edit.mode === 'theory') return [edit.reasoning.id, edit.conclusion.id].filter(Boolean);
  return edit.reasoning.id ? [edit.reasoning.id] : [];
}

export class SupabaseSyncAdapter implements SyncAdapter {
  private readonly request: typeof fetch;
  private readonly pageSize: number;
  private readonly auth: KnowledgeBallAuthClient;
  private readonly nodeCreationById = new Map<string, NodeCreationMetadata>();
  private readonly contributorNameById = new Map<string, string>();

  constructor(private readonly config: SupabaseConfig) {
    this.request = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.pageSize = config.pageSize ?? 200;
    this.auth = new KnowledgeBallAuthClient({ url: config.url, publishableKey: config.publishableKey, storage: config.storage as Storage | null | undefined, fetch: this.request });
  }

  nodeMetadata(nodeId: string): NodePresentationMetadata | null {
    const creation = this.nodeCreationById.get(nodeId);
    if (!creation) return null;
    return {
      actorId: creation.actorId,
      createdAt: creation.createdAt,
      contributor: this.contributorNameById.get(creation.actorId) ?? '匿名贡献者',
    };
  }

  async pull(cursor = '0'): Promise<SyncBatch> {
    let head = Number(cursor);
    const events: PublicKnowledgeEvent[] = [];
    const actorIds = new Set<string>();
    while (true) {
      const params = new URLSearchParams({ select: 'sequence,envelope,actor_id,created_at', sequence: `gt.${head}`, order: 'sequence.asc', limit: String(this.pageSize) });
      const rows = await this.api<EventRow[]>(`/rest/v1/public_knowledge_events?${params}`);
      for (const row of rows) {
        if (!isPublicKnowledgeEvent(row.envelope)) {
          throw new Error(`public_knowledge_events contains non-public event at sequence ${row.sequence}`);
        }
        const actorId = cleanText(row.actor_id);
        const createdAt = cleanText(row.created_at);
        if (actorId && createdAt) {
          actorIds.add(actorId);
          for (const nodeId of createdNodeIdsFromEvent(row.envelope)) {
            if (!this.nodeCreationById.has(nodeId)) this.nodeCreationById.set(nodeId, { actorId, createdAt });
          }
        }
        head = Math.max(head, row.sequence);
        events.push(row.envelope);
      }
      if (rows.length < this.pageSize) break;
    }
    await this.hydrateContributorNames(actorIds);
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

  private async hydrateContributorNames(actorIds: ReadonlySet<string>): Promise<void> {
    const missing = [...actorIds].filter(actorId => !this.contributorNameById.has(actorId));
    for (let start = 0; start < missing.length; start += 100) {
      const batch = missing.slice(start, start + 100);
      if (!batch.length) continue;
      try {
        const rows = await this.api<ContributorRow[]>('/rest/v1/rpc/get_public_contributor_profiles', {
          method: 'POST',
          body: JSON.stringify({ actor_ids: batch }),
        });
        for (const row of rows) {
          const actorId = cleanText(row.actor_id);
          if (!actorId) continue;
          this.contributorNameById.set(actorId, cleanText(row.contributor) || '未命名贡献者');
        }
      } catch (error) {
        // Contributor labels are presentation metadata. A lookup failure must
        // never prevent the authoritative public event stream from loading.
        console.warn('[Knowledge-Ball] contributor profile lookup deferred:', error);
      }
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
