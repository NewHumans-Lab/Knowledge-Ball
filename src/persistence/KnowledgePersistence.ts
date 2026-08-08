export type KnowledgeEvent = Record<string, unknown>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KnowledgePersistenceOptions {
  storageKey: string;
  storage?: StorageLike | null;
}

interface PersistedEnvelope<TEvent> {
  schemaVersion: 1;
  savedAt: string;
  events: TEvent[];
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function fingerprint(event: KnowledgeEvent): string {
  const id = typeof event.id === 'string' ? event.id : typeof event.eventId === 'string' ? event.eventId : null;
  return id ?? JSON.stringify(canonicalize(event));
}

export function dedupeEvents<TEvent extends KnowledgeEvent>(events: TEvent[]): TEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = fingerprint(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class KnowledgePersistence<TEvent extends KnowledgeEvent = KnowledgeEvent> {
  private readonly storageKey: string;
  private readonly storage: StorageLike | null;

  constructor(options: KnowledgePersistenceOptions) {
    this.storageKey = options.storageKey;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
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
    const envelope: PersistedEnvelope<TEvent> = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      events: dedupeEvents(events),
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch {
      // LocalStorage may be unavailable or full; the in-memory event store remains usable.
    }
  }

  clearLocal(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      // Ignore unavailable storage.
    }
  }
}
