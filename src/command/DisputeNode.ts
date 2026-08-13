import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type NodeDisputedEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export async function disputeNode(
  store: EventStore<GraphState>,
  payload: { nodeId: string }
): Promise<NodeDisputedEvent> {
  const id = await fingerprint('NodeDisputed', payload);
  const event: NodeDisputedEvent = {
    id,
    type: 'NodeDisputed',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
  store.append(event);
  return event;
}
