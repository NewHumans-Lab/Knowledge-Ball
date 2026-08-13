import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type NodeSuspendedEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export async function suspendNode(
  store: EventStore<GraphState>,
  payload: { nodeId: string }
): Promise<NodeSuspendedEvent> {
  const id = await fingerprint('NodeSuspended', { ...payload, standalone: true });
  const event: NodeSuspendedEvent = {
    id,
    type: 'NodeSuspended',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: { nodeId: payload.nodeId, causeNodeId: payload.nodeId },
  };
  store.append(event);
  return event;
}
