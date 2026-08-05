import { DomainEvent } from './Event';

// 持久化接口，先定义抽象层，方便以后换成 IndexedDB / 文件 / 链上存储
export interface EventPersistence {
  loadAll(): Promise<DomainEvent[]>;
  appendBatch(events: DomainEvent[]): Promise<void>;
}

export class EventStore {
  private events: DomainEvent[] = [];
  private seenIds = new Set<string>(); // 幂等去重

  constructor(private persistence: EventPersistence) {}

  async load(): Promise<DomainEvent[]> {
    this.events = await this.persistence.loadAll();
    this.events.sort((a, b) => a.seq - b.seq);
    this.seenIds = new Set(this.events.map(e => e.id));
    return this.events;
  }

  // 只能追加，且拒绝重复事件（同一 command 因网络重试导致的重复提交）
  async append(event: DomainEvent): Promise<boolean> {
    if (this.seenIds.has(event.id)) {
      console.warn(`[EventStore] duplicate event rejected: ${event.id}`);
      return false;
    }
    this.events.push(event);
    this.seenIds.add(event.id);
    await this.persistence.appendBatch([event]);
    return true;
  }

  getAll(): readonly DomainEvent[] {
    return this.events;
  }

  getAfter(seq: number): DomainEvent[] {
    // 给快照机制用：只取快照之后的增量事件
    return this.events.filter(e => e.seq > seq);
  }

  getLastSeq(): number {
    return this.events.length ? this.events[this.events.length - 1].seq : 0;
  }
}