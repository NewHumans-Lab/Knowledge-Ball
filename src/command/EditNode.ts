import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type DomainEvent, type KnowledgeNodeEditedEvent, type NodeType } from '../event/Event';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';
import { GraphProjection } from '../projection/GraphProjection';
import { executeKnowledgeOptimization } from './KnowledgeOptimization';
import { executeKnowledgeOpposition } from './KnowledgeOpposition';
import { decodeLineageIntent } from '../ui/LineageIntentBridge';

export interface EditNodePayload {
  nodeId: string;
  title?: string;
  nodeType?: NodeType;
  reasoning?: string;
  premises?: string[];
}

function candidateId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `n-${random}`;
}

/**
 * Compatibility command boundary.
 *
 * The legacy panel callback still arrives here as an "edit" so unrelated UI is
 * left untouched. An explicit KBL3 lineage intent is decoded into the real
 * immutable optimization/opposition command before any event is created.
 * Ordinary non-product callers retain the historical KnowledgeNodeEdited path
 * for replay/regression tooling; hosted validation rejects new legacy semantic
 * edits at the public write boundary.
 */
export async function editNode(
  store: EventStore<GraphState>,
  payload: EditNodePayload,
  committer?: EventCommitter,
): Promise<DomainEvent> {
  const intent = decodeLineageIntent(payload.title, payload.reasoning);
  if (intent) {
    const projection = new GraphProjection();
    projection.hydrate(null, store.allEvents());
    const target = projection.state.nodesById[payload.nodeId];
    if (!target) throw new Error(`Lineage edit target not found: ${payload.nodeId}`);
    const input = {
      targetId: target.id,
      candidateId: candidateId(),
      title: intent.title,
      reasoning: intent.description,
      declaredLayer: intent.layer,
    };
    return intent.kind === 'optimization'
      ? executeKnowledgeOptimization(store, projection, input, committer)
      : executeKnowledgeOpposition(store, projection, input, committer);
  }

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
  const accepted = committer ? await committer(event) : store.append(event);
  if (!accepted) throw new Error(`Duplicate knowledge edit event: ${id}`);
  return event;
}
