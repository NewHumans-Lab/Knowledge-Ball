import type { DomainEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { SyncAdapter } from './SyncAdapter';

export class SyncEngine<TState> {
  private cursor: string | undefined;

  constructor(
    private readonly store: EventStore<TState>,
    private readonly adapter: SyncAdapter<DomainEvent>
  ) {}

  async sync(): Promise<void> {
    const remote = await this.adapter.pull(this.cursor);
    for (const event of remote.events) this.store.append(event);
    const result = await this.adapter.push(this.store.allEvents(), remote.cursor ?? this.cursor);
    this.cursor = result.cursor ?? remote.cursor ?? this.cursor;
  }
}
