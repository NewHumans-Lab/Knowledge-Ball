import { DomainEvent } from '../event/Event';

// Projection 的核心契约：事件 -> 状态变更，纯函数式 reducer
export interface Projection<S> {
  apply(state: S, event: DomainEvent): S;
}

export function replay<S>(
  projection: Projection<S>,
  initialState: S,
  events: readonly DomainEvent[]
): S {
  return events.reduce((state, evt) => projection.apply(state, evt), initialState);
}