import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type Mastery, type NodeMasterySetEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export async function setMastery(
  store: EventStore<GraphState>,
  payload: { nodeId: string; mastery: Mastery }
): Promise<NodeMasterySetEvent> {
  const id = await fingerprint('NodeMasterySet', payload);
  const event: NodeMasterySetEvent = {
    id,
    type: 'NodeMasterySet',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
  store.append(event);
  return event;
}
