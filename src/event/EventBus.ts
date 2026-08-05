import type { DomainEvent } from './Event';

type Handler = (e: DomainEvent) => void;

export class EventBus {
  private handlers = new Set<Handler>();

  on(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: DomainEvent): void {
    this.handlers.forEach(h => h(event));
  }
}
