import { DomainEvent, createEvent } from './Event';
import { EventStore } from './EventStore';
import { EventBus } from './EventBus';

// Command 层：负责校验 + 生成事件，不直接改状态
export interface CommandHandler<P> {
  commandName: string;
  validate(payload: P, currentState: unknown): void; // 校验失败抛异常
}

export class CommandDispatcher {
  constructor(private store: EventStore, private bus: EventBus) {}

  async dispatch<P>(
    handler: CommandHandler<P>,
    user: string,
    payload: P,
    currentState: unknown
  ): Promise<DomainEvent<P>> {
    handler.validate(payload, currentState); // 校验放在写入事件前，事件本身不可撤销
    const event = createEvent(handler.commandName, user, payload);
    const ok = await this.store.append(event);
    if (ok) this.bus.publish(event);
    return event;
  }
}