import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type NodeCreatedEvent, type NodeType } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';

export interface CreateNodePayload {
  nodeId: string;
  title: string;
  nodeType: NodeType;
  reasoning: string;
  premises: string[];
  initialStatus?: import('../event/Event').NodeStatus;
  initialMastery?: import('../event/Event').Mastery;
  source?: 'import';
  hidden?: boolean;
  aliases?: string[];
  supersededBy?: string;
  logicRuleId?: string;
  negatedBy?: string[];
  semanticKey?: string;
}

export async function createNode(
  store: EventStore<GraphState>,
  payload: CreateNodePayload
): Promise<NodeCreatedEvent> {
  const id = await fingerprint('NodeCreated', payload);
  const event: NodeCreatedEvent = {
    id,
    type: 'NodeCreated',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: Date.now(),
    payload,
  };
  store.append(event);
  return event;
}
