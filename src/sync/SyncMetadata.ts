import type { StorageLike } from '../persistence/KnowledgePersistence';

export interface FailedSyncEvent { eventId: string; reason: string; failedAt: string; }
export interface SyncMetadata {
  schemaVersion: 1;
  cursor: string;
  pendingEventIds: string[];
  acknowledgedEventIds: string[];
  failedEvents: FailedSyncEvent[];
}

const KEY = 'knowledge-ball.sync-metadata.v1';
const empty = (): SyncMetadata => ({ schemaVersion: 1, cursor: '0', pendingEventIds: [], acknowledgedEventIds: [], failedEvents: [] });

export class SyncMetadataStore {
  constructor(private readonly storage: StorageLike | null = typeof window === 'undefined' ? null : window.localStorage) {}
  load(): SyncMetadata {
    try {
      const parsed = JSON.parse(this.storage?.getItem(KEY) ?? 'null') as SyncMetadata | null;
      return parsed?.schemaVersion === 1 ? parsed : empty();
    } catch { return empty(); }
  }
  save(metadata: SyncMetadata): void {
    try { this.storage?.setItem(KEY, JSON.stringify(metadata)); } catch { /* local events remain authoritative */ }
  }
}
