export type KnowledgeEvent = Record<string, unknown>;

export interface KnowledgePersistenceOptions {
  storageKey: string;
  remoteEndpoint?: string;
}

interface PersistedEnvelope<TEvent> {
  schemaVersion: 1;
  savedAt: string;
  events: TEvent[];
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function fingerprint(event: KnowledgeEvent): string {
  const id =
    typeof event.eventId === 'string'
      ? event.eventId
      : typeof event.id === 'string'
        ? event.id
        : null;

  if (id) return id;

  return stableStringify(event);
}

function dedupeEvents<TEvent extends KnowledgeEvent>(events: TEvent[]): TEvent[] {
  const seen = new Set<string>();
  const out: TEvent[] = [];

  for (const event of events) {
    const key = fingerprint(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }

  return out;
}

async function readJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Remote sync failed: ${res.status} ${res.statusText}`);
  }
}

export class KnowledgePersistence<TEvent extends KnowledgeEvent = KnowledgeEvent> {
  private readonly storageKey: string;
  private readonly remoteEndpoint?: string;

  constructor(options: KnowledgePersistenceOptions) {
    this.storageKey = options.storageKey;
    this.remoteEndpoint = options.remoteEndpoint?.trim() || undefined;
  }

  loadLocal(): TEvent[] {
    const storage = getStorage();
    if (!storage) return [];

    try {
      const raw = storage.getItem(this.storageKey);
      if (!raw) return [];

      const parsed = JSON.parse(raw) as PersistedEnvelope<TEvent> | TEvent[];
      if (Array.isArray(parsed)) return dedupeEvents(parsed);

      if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.events)) {
        return dedupeEvents(parsed.events);
      }

      return [];
    } catch {
      return [];
    }
  }

  saveLocal(events: TEvent[]): void {
    const storage = getStorage();
    if (!storage) return;

    const envelope: PersistedEnvelope<TEvent> = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      events: dedupeEvents(events),
    };

    try {
      storage.setItem(this.storageKey, JSON.stringify(envelope));
    } catch {
      // Ignore quota/private-mode failures.
    }
  }

  clearLocal(): void {
    const storage = getStorage();
    if (!storage) return;

    try {
      storage.removeItem(this.storageKey);
    } catch {
      // Ignore.
    }
  }

  async loadRemote(): Promise<TEvent[]> {
    if (!this.remoteEndpoint) return [];

    try {
      const payload = await readJson<PersistedEnvelope<TEvent> | TEvent[]>(this.remoteEndpoint);
      if (!payload) return [];

      if (Array.isArray(payload)) return dedupeEvents(payload);

      if (payload.schemaVersion === 1 && Array.isArray(payload.events)) {
        return dedupeEvents(payload.events);
      }

      return [];
    } catch {
      return [];
    }
  }

  async syncRemote(events: TEvent[]): Promise<void> {
    if (!this.remoteEndpoint) return;

    const envelope: PersistedEnvelope<TEvent> = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      events: dedupeEvents(events),
    };

    await postJson(this.remoteEndpoint, envelope);
  }

  async loadMerged(): Promise<TEvent[]> {
    const local = this.loadLocal();
    const remote = await this.loadRemote();

    if (remote.length === 0) return local;
    if (local.length === 0) return remote;

    return dedupeEvents([...local, ...remote]);
  }

  async persist(events: TEvent[]): Promise<void> {
    const deduped = dedupeEvents(events);
    this.saveLocal(deduped);

    try {
      await this.syncRemote(deduped);
    } catch {
      // Local persistence is the hard requirement.
      // Remote sync is best-effort.
    }
  }
}