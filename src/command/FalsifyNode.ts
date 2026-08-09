import type { DomainEvent } from '../event/Event';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';
import type { GraphProjection } from '../projection/GraphProjection';
import { executeKnowledgeEdit } from './KnowledgeEdit';
import type { NewProtocolNode } from '../protocol/KnowledgeEditingProtocol';

/**
 * Compatibility name for callers that previously used evidence-free falsification.
 * It now delegates to the canonical negate command and cannot be called without
 * explicit counterexamples.
 */
export interface FalsifyNodePayload {
  nodeId: string;
  counterexampleIds: string[];
  correctedReasoning?: NewProtocolNode;
}

export async function falsifyNode(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  payload: FalsifyNodePayload,
): Promise<DomainEvent[]> {
  const target = projection.state.nodesById[payload.nodeId];
  if (!target) throw new Error(`否定目标不存在: ${payload.nodeId}`);
  const event = await executeKnowledgeEdit(store, projection, {
    kind: 'negate',
    target: target.type === 'reasoning' ? 'reasoning' : 'conclusion',
    targetId: payload.nodeId,
    counterexampleIds: payload.counterexampleIds,
    correctedReasoning: payload.correctedReasoning,
  });
  return [event];
}
