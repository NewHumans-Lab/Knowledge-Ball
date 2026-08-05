import type { DomainEvent } from '../event/Event';

export interface Projection<TState> {
  state: TState;
  apply(event: DomainEvent): void;
  reset(seed: TState): void;
}
