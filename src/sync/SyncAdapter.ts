import type { PublicKnowledgeEvent } from '../event/Event';

export interface SyncBatch {
  events: PublicKnowledgeEvent[];
  cursor: string;
}

export interface PushResult { cursor: string; acknowledgedEventIds: string[]; }

export class RemoteHeadConflictError extends Error {
  constructor(readonly currentCursor: string) {
    super(`Remote head changed to ${currentCursor}`);
    this.name = 'RemoteHeadConflictError';
  }
}

export interface SyncAdapter {
  pull(cursor?: string): Promise<SyncBatch>;
  push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult>;
}
