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

interface ChunkedJournalMarker {
  schemaVersion: 2;
  format: 'chunked-journal';
  chunkCount: number;
  chunkSize: number;
  savedAt: string;
}

interface PersistedJournalChunk<TEvent> {
  schemaVersion: 1;
  events: TEvent[];
}

const JOURNAL_CHUNK_SIZE = 32;

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

type JournalLoadResult<TEvent> = { present: boolean; events: TEvent[] };

/**
 * A localStorage-backed append journal with a fixed upper bound on rewrite work.
 * Existing chunks are never compacted during normal writes: appending one event
 * rewrites at most JOURNAL_CHUNK_SIZE events, while the complete audit history is
 * reconstructed only when the application boots.
 */
class ChunkedKnowledgeJournal<TEvent extends KnowledgeEvent> {
  private readonly storageKey: string;
  private readonly storage: StorageLike | null;
  private loaded = false;
  private present = false;
  private chunkSize = JOURNAL_CHUNK_SIZE;
  private chunks: TEvent[][] = [];
  private readonly seen = new Set<string>();

  constructor(storageKey: string, storage: StorageLike | null) {
    this.storageKey = storageKey;
    this.storage = storage;
  }

  private chunkKey(index: number): string {
    return `${this.storageKey}.chunk.v2.${index}`;
  }

  private marker(chunkCount = this.chunks.length): ChunkedJournalMarker {
    return {
      schemaVersion: 2,
      format: 'chunked-journal',
      chunkCount,
      chunkSize: this.chunkSize,
      savedAt: new Date().toISOString(),
    };
  }

  loadLocal(): JournalLoadResult<TEvent> {
    if (this.loaded) {
      return { present: this.present, events: dedupeEvents(this.chunks.flat()) };
    }
    this.loaded = true;
    if (!this.storage) return { present: false, events: [] };

    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return { present: false, events: [] };
      const marker = JSON.parse(raw) as Partial<ChunkedJournalMarker>;
      if (
        marker.schemaVersion !== 2
        || marker.format !== 'chunked-journal'
        || !Number.isInteger(marker.chunkCount)
        || (marker.chunkCount ?? -1) < 0
      ) {
        return { present: false, events: [] };
      }
      this.chunkSize = Number.isInteger(marker.chunkSize) && (marker.chunkSize ?? 0) > 0
        ? marker.chunkSize!
        : JOURNAL_CHUNK_SIZE;
      const loadedChunks: TEvent[][] = [];
      for (let index = 0; index < marker.chunkCount!; index += 1) {
        const chunkRaw = this.storage.getItem(this.chunkKey(index));
        if (!chunkRaw) return { present: false, events: [] };
        const chunk = JSON.parse(chunkRaw) as PersistedJournalChunk<TEvent>;
        if (chunk?.schemaVersion !== 1 || !Array.isArray(chunk.events)) return { present: false, events: [] };
        loadedChunks.push(chunk.events);
      }
      this.chunks = loadedChunks;
      this.present = true;
      for (const event of dedupeEvents(this.chunks.flat())) this.seen.add(fingerprint(event));
      return { present: true, events: dedupeEvents(this.chunks.flat()) };
    } catch {
      return { present: false, events: [] };
    }
  }

  importIfEmpty(events: TEvent[]): boolean {
    const existing = this.loadLocal();
    if (existing.present) return true;
    if (!this.storage) return false;
    const unique = dedupeEvents(events);
    const chunks: TEvent[][] = [];
    for (let offset = 0; offset < unique.length; offset += this.chunkSize) {
      chunks.push(unique.slice(offset, offset + this.chunkSize));
    }

    const written: number[] = [];
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        this.storage.setItem(this.chunkKey(index), JSON.stringify({ schemaVersion: 1, events: chunks[index] } satisfies PersistedJournalChunk<TEvent>));
        written.push(index);
      }
      this.storage.setItem(this.storageKey, JSON.stringify(this.marker(chunks.length)));
    } catch {
      for (const index of written) {
        try { this.storage.removeItem(this.chunkKey(index)); } catch { /* best effort rollback */ }
      }
      return false;
    }

    this.chunks = chunks;
    this.present = true;
    this.seen.clear();
    for (const event of unique) this.seen.add(fingerprint(event));
    return true;
  }

  appendLocal(event: TEvent): boolean {
    this.loadLocal();
    if (!this.storage) return false;
    const key = fingerprint(event);
    if (this.seen.has(key)) return true;

    performance.mark?.('knowledge-personal-journal-start');
    try {
      if (!this.present || this.chunks.length === 0) {
        const firstChunk = [event];
        this.storage.setItem(this.chunkKey(0), JSON.stringify({ schemaVersion: 1, events: firstChunk } satisfies PersistedJournalChunk<TEvent>));
        try {
          this.storage.setItem(this.storageKey, JSON.stringify(this.marker(1)));
        } catch (error) {
          try { this.storage.removeItem(this.chunkKey(0)); } catch { /* best effort rollback */ }
          throw error;
        }
        this.chunks = [firstChunk];
        this.present = true;
      } else {
        const lastIndex = this.chunks.length - 1;
        const lastChunk = this.chunks[lastIndex]!;
        if (lastChunk.length < this.chunkSize) {
          const nextChunk = [...lastChunk, event];
          this.storage.setItem(this.chunkKey(lastIndex), JSON.stringify({ schemaVersion: 1, events: nextChunk } satisfies PersistedJournalChunk<TEvent>));
          this.chunks[lastIndex] = nextChunk;
        } else {
          const nextIndex = this.chunks.length;
          const nextChunk = [event];
          this.storage.setItem(this.chunkKey(nextIndex), JSON.stringify({ schemaVersion: 1, events: nextChunk } satisfies PersistedJournalChunk<TEvent>));
          try {
            this.storage.setItem(this.storageKey, JSON.stringify(this.marker(nextIndex + 1)));
          } catch (error) {
            try { this.storage.removeItem(this.chunkKey(nextIndex)); } catch { /* best effort rollback */ }
            throw error;
          }
          this.chunks.push(nextChunk);
        }
      }
      this.seen.add(key);
    } catch {
      return false;
    }
    performance.mark?.('knowledge-personal-journal-end');
    performance.measure?.('knowledge-personal-journal', 'knowledge-personal-journal-start', 'knowledge-personal-journal-end');
    return true;
  }

  appendMany(events: TEvent[]): void {
    const current = this.loadLocal();
    if (!current.present && this.importIfEmpty(events)) return;
    for (const event of events) this.appendLocal(event);
  }

  clearLocal(): void {
    const current = this.loadLocal();
    if (!this.storage) return;
    const chunkCount = current.present ? this.chunks.length : 0;
    try {
      for (let index = 0; index < chunkCount; index += 1) this.storage.removeItem(this.chunkKey(index));
      // Keep an explicit empty journal marker so a read-only legacy cache cannot
      // resurrect personal state after the user intentionally clears it.
      this.chunks = [];
      this.seen.clear();
      this.present = true;
      this.storage.setItem(this.storageKey, JSON.stringify(this.marker(0)));
    } catch {
      return;
    }
  }
}

/**
 * Persists only the caller-selected event scope. The optional legacy key is
 * read only as a compatibility source; it is never cleared or rewritten.
 * Current personal events use a bounded append-only journal so a small personal
 * write never scans or serializes the public/domain event history.
 */
export class FilteredKnowledgePersistence<TEvent extends KnowledgeEvent = KnowledgeEvent> {
  private readonly current: KnowledgePersistence<TEvent>;
  private readonly legacy: KnowledgePersistence<TEvent> | null;
  private readonly retain: (event: TEvent) => boolean;
  private readonly journal: ChunkedKnowledgeJournal<TEvent>;

  constructor(options: FilteredKnowledgePersistenceOptions<TEvent>) {
    this.retain = options.retain;
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    this.current = new KnowledgePersistence<TEvent>({ storageKey: options.storageKey, storage });
    this.legacy = options.legacyStorageKey
      ? new KnowledgePersistence<TEvent>({ storageKey: options.legacyStorageKey, storage })
      : null;
    this.journal = new ChunkedKnowledgeJournal<TEvent>(options.storageKey, storage);
  }

  loadLocal(): TEvent[] {
    const journal = this.journal.loadLocal();
    if (journal.present) return journal.events.filter(this.retain);

    const current = this.current.loadLocal().filter(this.retain);
    if (current.length) {
      this.journal.importIfEmpty(current);
      return current;
    }

    const legacy = this.legacy?.loadLocal().filter(this.retain) ?? [];
    if (legacy.length) this.journal.importIfEmpty(legacy);
    return legacy;
  }

  /** Compatibility bulk API. Normal EventStore writes use appendLocal instead. */
  saveLocal(events: TEvent[]): void {
    this.journal.appendMany(events.filter(this.retain));
  }

  appendLocal(event: TEvent): void {
    if (this.retain(event)) this.journal.appendLocal(event);
  }

  shouldPersist(event: TEvent): boolean {
    return this.retain(event);
  }

  clearLocal(): void {
    this.journal.clearLocal();
  }
}
