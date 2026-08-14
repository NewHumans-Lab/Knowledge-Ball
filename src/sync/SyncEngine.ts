import { isCanonicalPublicKnowledgeEvent, isPublicKnowledgeEvent, type DomainEvent, type PublicKnowledgeEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import { RemoteHeadConflictError, type SyncAdapter } from './SyncAdapter';
import { SyncMetadataStore, type FailedSyncEvent, type SyncMetadata } from './SyncMetadata';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'unavailable' | 'conflict';
export type EventValidator = (event: PublicKnowledgeEvent, rebaseBase?: readonly DomainEvent[]) => string | null;

export class SyncEngine<TState> {
  private metadata: SyncMetadata;
  private applyingRemote = false;
  private running: Promise<void> | null = null;
  private status: SyncStatus = 'idle';
  private readonly listeners = new Set<(status: SyncStatus, failures: FailedSyncEvent[]) => void>();

  constructor(
    private readonly store: EventStore<TState>,
    private readonly adapter: SyncAdapter | null,
    private readonly metadataStore = new SyncMetadataStore(),
    private readonly validate: EventValidator = () => null,
    private readonly shouldQueue: (event:DomainEvent)=>boolean = isCanonicalPublicKnowledgeEvent,
  ) {
    this.metadata = metadataStore.load();
    store.subscribe(event => {
      if (!this.applyingRemote && this.shouldQueue(event)) this.queue(event.id);
    }, false);

    // The web app restores and may seed local events before the SyncEngine is
    // constructed. Reconcile those already-present public events so enabling a
    // hosted adapter later does not permanently strand them in localStorage.
    for (const event of store.allEvents()) {
      if (this.shouldQueue(event)) this.queue(event.id);
    }
    this.reconcileDisallowedPendingEvents();

    if (!adapter) this.setStatus('unavailable');
  }

  currentStatus(): SyncStatus { return this.status; }
  pendingCount(): number { return this.metadata.pendingEventIds.length; }
  failures(): FailedSyncEvent[] { return [...this.metadata.failedEvents]; }
  subscribe(listener: (status: SyncStatus, failures: FailedSyncEvent[]) => void): () => void {
    this.listeners.add(listener); listener(this.status, this.failures());
    return () => this.listeners.delete(listener);
  }

  sync(): Promise<void> {
    if (!this.adapter) { this.setStatus('unavailable'); return Promise.resolve(); }
    if (this.running) return this.running;
    this.running = this.performSync().finally(() => { this.running = null; });
    return this.running;
  }

  private async performSync(): Promise<void> {
    this.setStatus('syncing');
    try {
      await this.pullAndApply();
      await this.pushWithRebase();
      this.setStatus(this.metadata.failedEvents.length ? 'conflict' : 'idle');
    } catch (error) {
      this.setStatus(error instanceof RemoteHeadConflictError ? 'conflict' : 'offline');
      throw error;
    }
  }

  private async pullAndApply(): Promise<void> {
    const batch = await this.adapter!.pull(this.metadata.cursor);
    const remoteEventIds: string[] = [];
    this.applyingRemote = true;
    try {
      for (const event of batch.events) {
        if (!isPublicKnowledgeEvent(event)) continue;
        remoteEventIds.push(event.id);
        const invalid = this.validate(event);
        if (!invalid) this.store.append(event);
      }
    } finally { this.applyingRemote = false; }

    if (remoteEventIds.length) {
      const acknowledged = new Set([...this.metadata.acknowledgedEventIds, ...remoteEventIds]);
      this.metadata.acknowledgedEventIds = [...acknowledged];
      this.metadata.pendingEventIds = this.metadata.pendingEventIds.filter(id => !acknowledged.has(id));
    }
    this.metadata.cursor = batch.cursor;
    this.persist();
  }

  private async pushWithRebase(): Promise<void> {
    let pending = this.pendingEvents();
    if (!pending.length) return;
    try {
      this.acknowledge(await this.adapter!.push(pending, this.metadata.cursor));
    } catch (error) {
      if (!(error instanceof RemoteHeadConflictError)) throw error;
      await this.pullAndApply();
      const pendingIds = new Set(pending.map(event => event.id));
      const rebaseBase: DomainEvent[] = this.store.allEvents().filter(event => !pendingIds.has(event.id));
      pending = pending.filter(event => {
        const reason = this.validate(event, rebaseBase);
        if (reason) { this.fail(event.id, reason); return false; }
        rebaseBase.push(event);
        return true;
      });
      if (pending.length) this.acknowledge(await this.adapter!.push(pending, this.metadata.cursor));
    }
  }

  private pendingEvents(): PublicKnowledgeEvent[] {
    const wanted = new Set(this.metadata.pendingEventIds);
    return this.store.allEvents().filter(isCanonicalPublicKnowledgeEvent).filter(event => wanted.has(event.id));
  }
  private reconcileDisallowedPendingEvents(): void {
    const byId = new Map(this.store.allEvents().map(event => [event.id, event]));
    const disallowedIds = this.metadata.pendingEventIds.filter(id => {
      const event = byId.get(id);
      return event !== undefined && isPublicKnowledgeEvent(event) && !this.shouldQueue(event);
    });
    if (!disallowedIds.length) return;
    const failed = new Set(this.metadata.failedEvents.map(item => item.eventId));
    this.metadata.pendingEventIds = this.metadata.pendingEventIds.filter(id => !disallowedIds.includes(id));
    for (const eventId of disallowedIds) {
      const event=byId.get(eventId)!;
      if(isCanonicalPublicKnowledgeEvent(event)){
        if(!this.metadata.acknowledgedEventIds.includes(eventId))this.metadata.acknowledgedEventIds.push(eventId);
      }else if (!failed.has(eventId)) this.metadata.failedEvents.push({eventId,reason:'旧版离线公共事件不能静默同步；请在当前版本重新提交该更改',failedAt:new Date().toISOString()});
    }
    this.persist();
  }
  private queue(id: string): void {
    if (!this.metadata.acknowledgedEventIds.includes(id) && !this.metadata.pendingEventIds.includes(id)) {
      this.metadata.pendingEventIds.push(id); this.persist();
    }
  }
  private acknowledge(result: { cursor: string; acknowledgedEventIds: string[] }): void {
    const acknowledged = new Set([...this.metadata.acknowledgedEventIds, ...result.acknowledgedEventIds]);
    this.metadata.acknowledgedEventIds = [...acknowledged];
    this.metadata.pendingEventIds = this.metadata.pendingEventIds.filter(id => !acknowledged.has(id));
    this.metadata.cursor = result.cursor; this.persist();
  }
  private fail(eventId: string, reason: string): void {
    this.metadata.pendingEventIds = this.metadata.pendingEventIds.filter(id => id !== eventId);
    this.metadata.failedEvents.push({ eventId, reason, failedAt: new Date().toISOString() }); this.persist();
  }
  private persist(): void { this.metadataStore.save(this.metadata); }
  private setStatus(status: SyncStatus): void {
    this.status = status; for (const listener of this.listeners) listener(status, this.failures());
  }
}
