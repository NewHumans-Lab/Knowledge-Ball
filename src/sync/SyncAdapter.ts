export interface SyncBatch<TEvent> {
  events: TEvent[];
  cursor?: string;
}

export interface SyncAdapter<TEvent> {
  pull(cursor?: string): Promise<SyncBatch<TEvent>>;
  push(events: TEvent[], cursor?: string): Promise<{ cursor?: string }>;
}
