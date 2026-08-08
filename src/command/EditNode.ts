import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type NodeEditedEvent, type NodeType } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export interface EditNodePayload {
  nodeId: string;
  title?: string;
  nodeType?: NodeType;
  reasoning?: string;
  premises?: string[];
}

export async function editNode(store: EventStore<GraphState>, payload: EditNodePayload): Promise<NodeEditedEvent> {
  const id = await fingerprint('NodeEdited', payload);
  const event: NodeEditedEvent = {
    id,
    type: 'NodeEdited',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
  store.append(event);
  return event;
}
