import { DomainEvent } from './Event';

type Listener = (event: DomainEvent) => void;

// 事件写入 Store 成功后广播，供 Projection 增量更新，避免每次都全量 Replay
export class EventBus {
  private listeners: Listener[] = [];

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  publish(event: DomainEvent): void {
    for (const l of this.listeners) l(event);
  }
}