// 事件的最小单元定义
export interface DomainEvent<P = Record<string, unknown>> {
  id: string;           // 事件全局唯一ID (用于幂等去重)
  seq: number;           // 单调递增序号，Replay顺序的唯一依据
  timestamp: number;      // Unix ms
  user: string;           // 发起者
  command: string;        // 命令类型，如 'CreateNode'
  version: number;        // payload schema 版本号，从1开始
  payload: P;
}

// 创建事件的工厂函数，负责生成 id / seq / timestamp
let seqCounter = 0;

export function createEvent<P>(
  command: string,
  user: string,
  payload: P,
  version = 1
): DomainEvent<P> {
  seqCounter += 1;
  return {
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    seq: seqCounter,
    timestamp: Date.now(),
    user,
    command,
    version,
    payload,
  };
}

export function resetSeqCounter(startAt: number) {
  // Store 加载完历史事件后，用最后一个 seq 恢复计数器
  seqCounter = startAt;
}