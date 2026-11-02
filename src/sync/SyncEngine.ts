import {
  isCanonicalPublicKnowledgeEvent,
  type DomainEvent,
  type PublicKnowledgeEvent,
} from '../event/Event';
import type { EventStore } from '../event/EventStore';
import { RemoteHeadConflictError, type SyncAdapter } from './SyncAdapter';
import type { FailedSyncEvent } from './SyncMetadata';
import { PublicKnowledgeSyncCoordinator } from './PublicKnowledgeSyncCoordinator';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unavailable' | 'conflict';
export type EventValidator = (event: PublicKnowledgeEvent) => string | null;

const MAX_REMOTE_HEAD_RETRIES = 3;

/**
 * Hosted public knowledge is server-authoritative.
 *
 * The engine keeps only an in-memory cursor for the current page lifetime. A
 * refresh starts from cursor 0 and rebuilds public knowledge from Supabase;
 * there is no durable pending queue, acknowledged-ID cache, or local rebase
 * state. Public commands use commit() so the server accepts the event before it
 * is applied to the in-memory EventStore.
 */
export class SyncEngine<TState> {
  private cursor = '0';
  private status: SyncStatus = 'idle';
  private readonly listeners = new Set<(status: SyncStatus, failures: FailedSyncEvent[]) => void>();
  private operationTail: Promise<void> = Promise.resolve();
  private readonly browserCoordinator: PublicKnowledgeSyncCoordinator | null;

  constructor(
    private readonly store: EventStore<TState>,
    private readonly adapter: SyncAdapter | null,
    private readonly validate: EventValidator = () => null,
  ) {
    if (!adapter) {
      this.browserCoordinator = null;
      this.setStatus('unavailable');
      return;
    }

    this.browserCoordinator = typeof window !== 'undefined' && typeof document !== 'undefined'
      ? new PublicKnowledgeSyncCoordinator(
          () => this.sync(),
          {
            onError: (error, reason) => console.warn(`[Knowledge-Ball] public sync ${reason} deferred:`, error),
          },
        )
      : null;
    this.browserCoordinator?.start();
  }

  currentStatus(): SyncStatus { return this.status; }
  currentCursor(): string { return this.cursor; }
  pendingCount(): number { return 0; }
  failures(): FailedSyncEvent[] { return []; }

  dispose(): void {
    this.browserCoordinator?.stop();
  }

  subscribe(listener: (status: SyncStatus, failures: FailedSyncEvent[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.failures());
    return () => this.listeners.delete(listener);
  }

  sync(): Promise<void> {
    if (!this.adapter) {
      this.setStatus('unavailable');
      return Promise.resolve();
    }
    return this.enqueue(async () => {
      this.setStatus('syncing');
      try {
        await this.pullAndApply();
        this.setStatus('idle');
      } catch (error) {
        this.setStatus('offline');
        throw error;
      }
    });
  }

  commit(event: DomainEvent): Promise<boolean> {
    if (!isCanonicalPublicKnowledgeEvent(event)) {
      return Promise.reject(new Error('Only canonical public knowledge events can be committed by the client'));
    }
    if (!this.adapter) {
      this.setStatus('unavailable');
      return Promise.reject(new Error('公共知识只认云端确认；远程数据库未配置，不能创建本地公共事实'));
    }
    return this.enqueue(() => this.performCommit(event));
  }

  private async performCommit(event: PublicKnowledgeEvent): Promise<boolean> {
    this.setStatus('syncing');

    for (let attempt = 0; attempt <= MAX_REMOTE_HEAD_RETRIES; attempt += 1) {
      // Refresh first so validation and the expected remote head use the same
      // authoritative prefix. After a head race, the next iteration revalidates
      // this event against the newly accepted server state.
      try {
        await this.pullAndApply();
      } catch (error) {
        this.setStatus('offline');
        throw error;
      }

      if (this.hasEvent(event.id)) {
        this.setStatus('idle');
        return true;
      }

      const invalid = this.validate(event);
      if (invalid) {
        this.setStatus('idle');
        throw new Error(invalid);
      }

      try {
        const result = await this.adapter!.push([event], this.cursor);
        if (!result.acknowledgedEventIds.includes(event.id)) {
          throw new Error('Server did not acknowledge public event ' + event.id);
        }
      } catch (error) {
        if (error instanceof RemoteHeadConflictError) {
          try {
            await this.pullAndApply();
          } catch (pullError) {
            this.setStatus('offline');
            throw pullError;
          }

          if (this.hasEvent(event.id)) {
            this.setStatus('idle');
            return true;
          }
          if (attempt < MAX_REMOTE_HEAD_RETRIES) {
            await new Promise(resolve => globalThis.setTimeout(resolve, 20 * (attempt + 1)));
            continue;
          }
          this.setStatus('conflict');
          throw error;
        }

        // A transport error can happen after Postgres committed but before the
        // response reached the browser. Pull to distinguish a lost response
        // from a write that never reached the authoritative event stream.
        try {
          await this.pullAndApply();
          if (this.hasEvent(event.id)) {
            this.setStatus('idle');
            return true;
          }
        } catch { /* preserve the original transport error */ }
        this.setStatus('offline');
        throw error;
      }

      // Pull server-authored events created by the same database transaction
      // before advancing the local cursor to the latest accepted head.
      try {
        await this.pullAndApply();
      } catch {
        if (!this.hasEvent(event.id)) this.store.appendValidated(event);
        this.setStatus('offline');
        return true;
      }

      if (!this.hasEvent(event.id)) this.store.appendValidated(event);
      this.setStatus('idle');
      return true;
    }

    this.setStatus('conflict');
    throw new Error('Public event commit exhausted its remote-head retries');
  }
  private async pullAndApply(): Promise<void> {
    const batch = await this.adapter!.pull(this.cursor);
    for (const event of batch.events) {
      // SyncAdapter.pull() returns PublicKnowledgeEvent by contract. Concrete
      // adapters must fail closed while decoding rows rather than silently
      // skipping invalid/non-public rows and advancing the remote cursor.
      // The public stream is the server's accepted history. Re-running
      // client-side state validation here can reject a valid authoritative
      // verdict when local state has diverged. Envelope validation still runs
      // inside appendValidated; the cursor advances only after the whole batch
      // has been incorporated successfully.
      this.store.appendValidated(event);
    }
    this.cursor = batch.cursor;
  }

  private hasEvent(eventId: string): boolean {
    return this.store.allEvents().some(event => event.id === eventId);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operationTail.then(operation, operation);
    this.operationTail = task.then(() => undefined, () => undefined);
    return task;
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status, this.failures());
  }
}
