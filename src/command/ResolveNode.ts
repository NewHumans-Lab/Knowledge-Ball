import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type NodeResolvedEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export async function resolveNode(
  store: EventStore<GraphState>,
  payload: { nodeId: string }
): Promise<NodeResolvedEvent> {
  const id = await fingerprint('NodeResolved', payload);
  const event: NodeResolvedEvent = {
    id,
    type: 'NodeResolved',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
  store.append(event);
  return event;
}
