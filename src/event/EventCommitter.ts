import type { DomainEvent } from './Event';

/**
 * Public commands create an event locally, but hosted callers may require the
 * server to accept that event before it enters the in-memory EventStore.
 */
export type EventCommitter = (event: DomainEvent) => Promise<boolean>;
