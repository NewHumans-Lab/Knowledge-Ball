import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type KnowledgeNodeEditedEvent, type NodeType } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export interface EditNodePayload {
  nodeId: string;
  title?: string;
  nodeType?: NodeType;
  reasoning?: string;
  premises?: string[];
}

export async function editNode(store: EventStore<GraphState>, payload: EditNodePayload): Promise<KnowledgeNodeEditedEvent> {
  const edit = { kind: 'update' as const, ...payload };
  const id = await fingerprint('KnowledgeNodeEdited', { edit });
  const event: KnowledgeNodeEditedEvent = {
    id,
    type: 'KnowledgeNodeEdited',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload: { edit },
  };
  store.append(event);
  return event;
}
