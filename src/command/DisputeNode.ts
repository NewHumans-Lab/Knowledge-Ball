import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type KnowledgeStatusChangedEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export async function disputeNode(
  store: EventStore<GraphState>,
  payload: { nodeId: string }
): Promise<KnowledgeStatusChangedEvent> {
  const edit = { kind: 'status' as const, nodeId: payload.nodeId, status: 'disputed' as const };
  const id = await fingerprint('KnowledgeStatusChanged', { edit });
  const event: KnowledgeStatusChangedEvent = {
    id,
    type: 'KnowledgeStatusChanged',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: { edit },
  };
  store.append(event);
  return event;
}
