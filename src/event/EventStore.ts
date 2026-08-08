import type { DomainEvent } from './Event';

export interface Snapshot<TState> {
  upToSeq: number;
  schemaVersion: number;
  state: TState;
  takenAt: number;
}

export interface StoreListener { (event: DomainEvent): void; }
export interface EventPersistence {
  loadLocal(): DomainEvent[];
  saveLocal(events: DomainEvent[]): void;
}

const SNAPSHOT_EVERY_N_EVENTS = 5000;

export class EventStore<TState> {
  private events: DomainEvent[] = [];
  private idIndex = new Set<string>();
  private listeners: StoreListener[] = [];
  private snapshot: Snapshot<TState> | null = null;
  private nextSeq = 1;

  constructor(
    private makeSnapshotState: () => TState,
    private persistence?: EventPersistence
  ) {}

  hydrateLocal(): DomainEvent[] {
    const loaded = this.persistence?.loadLocal() ?? [];
    this.restore(loaded);
    return this.allEvents();
  }

  restore(events: DomainEvent[]): void {
    this.events = [];
    this.idIndex.clear();
    this.snapshot = null;
    this.nextSeq = 1;
    for (const event of events) {
      if (this.idIndex.has(event.id)) continue;
      const stamped = { ...event, seq: this.nextSeq++ } as DomainEvent;
      this.events.push(stamped);
      this.idIndex.add(stamped.id);
    }
  }

  append(event: DomainEvent): boolean {
    if (this.idIndex.has(event.id)) {
      console.warn(`[EventStore] duplicate event id ${event.id} (${event.type}) — ignored`);
      return false;
    }
    const stamped: DomainEvent = { ...event, seq: this.nextSeq++ };
    this.events.push(stamped);
    this.idIndex.add(event.id);
    this.listeners.forEach(listener => listener(stamped));
    this.persistence?.saveLocal(this.events);

    if (this.events.length % SNAPSHOT_EVERY_N_EVENTS === 0) this.takeSnapshot();
    return true;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  eventsSinceSnapshot(): DomainEvent[] {
    const from = this.snapshot?.upToSeq ?? 0;
    return this.events.filter(e => (e.seq ?? 0) > from);
  }

  allEvents(): DomainEvent[] { return this.events.slice(); }
  latestSnapshot(): Snapshot<TState> | null { return this.snapshot; }

  takeSnapshot(): void {
    this.snapshot = {
      upToSeq: this.nextSeq - 1,
      schemaVersion: 1,
      state: this.makeSnapshotState(),
      takenAt: Date.now(),
    };
  }

  size(): number { return this.events.length; }
}
