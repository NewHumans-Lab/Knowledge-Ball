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
      return;
    }
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
