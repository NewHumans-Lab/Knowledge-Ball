export type KnowledgeEvent = object;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KnowledgePersistenceOptions {
  storageKey: string;
  storage?: StorageLike | null;
}

export interface FilteredKnowledgePersistenceOptions<TEvent extends KnowledgeEvent> extends KnowledgePersistenceOptions {
  legacyStorageKey?: string;
  retain: (event: TEvent) => boolean;
}

interface PersistedEnvelope<TEvent> {
  schemaVersion: 1;
  savedAt: string;
  events: TEvent[];
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function fingerprint(event: KnowledgeEvent): string {
  const record = event as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.eventId === 'string') return record.eventId;
  return JSON.stringify(event);
}

export function dedupeEvents<TEvent extends KnowledgeEvent>(events: TEvent[]): TEvent[] {
  const seen = new Set<string>();
  const result: TEvent[] = [];
  for (const event of events) {
    const key = fingerprint(event);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

export class KnowledgePersistence<TEvent extends KnowledgeEvent = KnowledgeEvent> {
  private readonly storageKey: string;
  private readonly storage: StorageLike | null;
  private pendingEvents: TEvent[] | null = null;
  private saveScheduled = false;

  constructor(options: KnowledgePersistenceOptions) {
    this.storageKey = options.storageKey;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    if (options.storage === undefined && typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushLocal());
    }
  }

  loadLocal(): TEvent[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as PersistedEnvelope<TEvent> | TEvent[];
      if (Array.isArray(parsed)) return dedupeEvents(parsed);
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.events)) return dedupeEvents(parsed.events);
      return [];
    } catch {
      return [];
    }
  }

  saveLocal(events: TEvent[]): void {
    if (!this.storage) return;
    if (typeof window !== 'undefined' && this.storage === window.localStorage) {
      this.pendingEvents = events;
      if (!this.saveScheduled) {
        this.saveScheduled = true;
        const flush = () => { this.saveScheduled = false; this.flushLocal(); };
        if ('requestIdleCallback' in window) window.requestIdleCallback(flush, { timeout: 500 });
        else globalThis.setTimeout(flush, 0);
      }
      return;
    }
    this.writeLocal(events);
  }

  flushLocal(): void {
    if (!this.pendingEvents) return;
    const events = this.pendingEvents;
    this.pendingEvents = null;
    this.writeLocal(events);
  }

  private writeLocal(events: TEvent[]): void {
    if (!this.storage) return;
    performance.mark?.('knowledge-persistence-start');
    const envelope: PersistedEnvelope<TEvent> = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      events: dedupeEvents(events),
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch {
      return;
    }
    performance.mark?.('knowledge-persistence-end');
    performance.measure?.('knowledge-persistence', 'knowledge-persistence-start', 'knowledge-persistence-end');
  }

  clearLocal(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      return;
    }
  }
}

/**
 * Persists only the caller-selected event scope. The optional legacy key is
 * read only as a compatibility source; it is never cleared or rewritten.
 * This lets production stop trusting the historical mixed public/local event
 * cache without destroying personal state that used to live beside it.
 */
export class FilteredKnowledgePersistence<TEvent extends KnowledgeEvent = KnowledgeEvent> {
  private readonly current: KnowledgePersistence<TEvent>;
  private readonly legacy: KnowledgePersistence<TEvent> | null;
  private readonly retain: (event: TEvent) => boolean;

  constructor(options: FilteredKnowledgePersistenceOptions<TEvent>) {
    this.retain = options.retain;
    this.current = new KnowledgePersistence<TEvent>({ storageKey: options.storageKey, storage: options.storage });
    this.legacy = options.legacyStorageKey
      ? new KnowledgePersistence<TEvent>({ storageKey: options.legacyStorageKey, storage: options.storage })
      : null;
  }

  loadLocal(): TEvent[] {
    const current = this.current.loadLocal().filter(this.retain);
    if (current.length) return current;
    const legacy = this.legacy?.loadLocal().filter(this.retain) ?? [];
    if (legacy.length) this.current.saveLocal(legacy);
    return legacy;
  }

  saveLocal(events: TEvent[]): void {
    this.current.saveLocal(events.filter(this.retain));
  }

  shouldPersist(event: TEvent): boolean {
    return this.retain(event);
  }

  clearLocal(): void {
    this.current.clearLocal();
  }
}
