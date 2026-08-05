import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type DomainEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';
import type { GraphProjection } from '../projection/GraphProjection';

export interface FalsifyNodePayload {
  nodeId: string;
}

export async function falsifyNode(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  payload: FalsifyNodePayload
): Promise<DomainEvent[]> {
  const now = Date.now();
  const falsifiedId = await fingerprint('NodeFalsified', payload, now);
  const falsifiedEvent: DomainEvent = {
    id: falsifiedId,
    type: 'NodeFalsified',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp: now,
    payload,
  };
  store.append(falsifiedEvent);

  const { ids, truncated } = projection.reachableForCascade(payload.nodeId);
  if (truncated) {
    console.warn(`[falsifyNode] cascade truncated by depth limit for ${payload.nodeId}`);
  }

  const cascadeEvents: DomainEvent[] = [];
  for (const depId of ids) {
    const suspendPayload = { nodeId: depId, causeNodeId: payload.nodeId };
    const id = await fingerprint('NodeSuspended', suspendPayload, now);
    const event: DomainEvent = {
      id,
      type: 'NodeSuspended',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      timestamp: now,
      payload: suspendPayload,
    };
    store.append(event);
    cascadeEvents.push(event);
  }

  return [falsifiedEvent, ...cascadeEvents];
}
