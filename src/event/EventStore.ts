import { migrateEventScope, type DomainEvent } from './Event';
import { KnowledgePersistence } from '../persistence/KnowledgePersistence';
import { DomainEventValidationError, validateDomainEventEnvelope } from './EventValidation';

export interface Snapshot<TState> { upToSeq: number; schemaVersion: number; state: TState; takenAt: number; }
export interface StoreListener { (event: DomainEvent): void; }
export interface EventPersistence {
  loadLocal(): DomainEvent[];
  saveLocal(events: DomainEvent[]): void;
  /** Optional incremental path for append-only persistence implementations. */
  appendLocal?(event: DomainEvent): void;
  shouldPersist?(event: DomainEvent): boolean;
}
const SNAPSHOT_EVERY_N_EVENTS = 5000;
const DEFAULT_STORAGE_KEY = 'knowledge-ball.events.v1';

export class EventStore<TState> {
  private events: DomainEvent[] = [];
  private idIndex = new Set<string>();
  private listeners: StoreListener[] = [];
  private snapshot: Snapshot<TState> | null = null;
  private nextSeq = 1;
  private readonly persistence: EventPersistence;

  constructor(
    private makeSnapshotState: () => TState,
    persistence?: EventPersistence,
    private validateEvent?: (event: DomainEvent) => string[],
  ) {
    this.persistence = persistence ?? new KnowledgePersistence<DomainEvent>({ storageKey: DEFAULT_STORAGE_KEY });
    this.restore(this.persistence.loadLocal());
  }

  hydrateLocal(): DomainEvent[] { this.restore(this.persistence.loadLocal()); return this.allEvents(); }

  restore(events: DomainEvent[]): void {
    this.events = [];
    this.idIndex.clear();
    this.snapshot = null;
    this.nextSeq = 1;
    for (const event of events) {
      if (this.idIndex.has(event.id)) continue;
      if (validateDomainEventEnvelope(event).length) continue;
      const stamped = { ...migrateEventScope(event), seq: this.nextSeq++ } as DomainEvent;
      this.events.push(stamped);
      this.idIndex.add(stamped.id);
    }
  }

  append(event: DomainEvent): boolean {
    return this.appendInternal(event, true);
  }

  /** Append an event whose state-dependent validation was already completed by its command or authoritative server. */
  appendValidated(event: DomainEvent): boolean {
    return this.appendInternal(event, false);
  }

  private appendInternal(event: DomainEvent, validateState: boolean): boolean {
    if (this.idIndex.has(event.id)) return false;
    const validationErrors = [
      ...validateDomainEventEnvelope(event),
      ...(validateState ? this.validateEvent?.(event) ?? [] : []),
    ];
    if (validationErrors.length) throw new DomainEventValidationError([...new Set(validationErrors)]);
    const stamped: DomainEvent = { ...event, seq: this.nextSeq++ };
    this.events.push(stamped);
    this.idIndex.add(event.id);
    this.listeners.forEach(listener => listener(stamped));
    if (this.persistence.shouldPersist?.(stamped) ?? true) {
      if (this.persistence.appendLocal) this.persistence.appendLocal(stamped);
      else this.persistence.saveLocal(this.events);
    }
    if (this.events.length % SNAPSHOT_EVERY_N_EVENTS === 0) this.takeSnapshot();
    return true;
  }

  subscribe(listener: StoreListener, replayExisting = true): () => void {
    this.listeners.push(listener);
    if (replayExisting) this.events.forEach(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  eventsSinceSnapshot(): DomainEvent[] {
    const from = this.snapshot?.upToSeq ?? 0;
    return this.events.filter(e => (e.seq ?? 0) > from);
  }
  allEvents(): DomainEvent[] { return this.events.slice(); }
  latestSnapshot(): Snapshot<TState> | null { return this.snapshot; }
  takeSnapshot(): void {
    this.snapshot = { upToSeq: this.nextSeq - 1, schemaVersion: 1, state: this.makeSnapshotState(), takenAt: Date.now() };
  }
  size(): number { return this.events.length; }
}
