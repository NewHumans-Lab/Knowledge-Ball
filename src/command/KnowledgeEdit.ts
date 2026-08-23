import { fingerprint } from '../event/Command';
import {
  CURRENT_SCHEMA_VERSION,
  type DomainEvent,
} from '../event/Event';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { GraphState } from '../state/GraphState';
import type { GraphProjection } from '../projection/GraphProjection';
import {
  validateKnowledgeEdit,
  type KnowledgeEdit,
  type ProtocolNode,
} from '../protocol/KnowledgeEditingProtocol';

export class KnowledgeEditValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('；'));
    this.name = 'KnowledgeEditValidationError';
  }
}

export function protocolNodesFromState(state: GraphState): ProtocolNode[] {
  return Object.values(state.nodesById).map(node => ({
    id: node.id,
    title: node.title,
    type: node.type,
    reasoning: node.reasoning,
    premises: [...node.premises],
    status: node.status,
    hidden: node.hidden,
    aliases: node.aliases ? [...node.aliases] : undefined,
    supersededBy: node.supersededBy,
    logicRuleId: node.logicRuleId,
    negatedBy: node.negatedBy ? [...node.negatedBy] : undefined,
    semanticKey: node.semanticKey,
    lineage: node.lineage ? structuredClone(node.lineage) : undefined,
  }));
}

function eventTypeFor(edit: KnowledgeEdit): DomainEvent['type'] {
  if (edit.kind === 'add') return 'KnowledgeAdded';
  if (edit.kind === 'negate') return 'KnowledgeNegated';
  if (edit.kind === 'decompose') return 'KnowledgeDecomposed';
  return 'KnowledgeMerged';
}

/**
 * The only write boundary for add/negate/decompose/merge. Validation runs against
 * the complete projection, including default-hidden historical nodes, before a
 * single atomic event is committed. Hosted callers may inject a server-first
 * committer; tests and unconfigured local sessions retain the direct EventStore
 * path.
 */
export async function executeKnowledgeEdit(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  edit: KnowledgeEdit,
  committer?: EventCommitter,
  declaredLayers?: Readonly<Record<string, UserKnowledgeLayer>>,
): Promise<DomainEvent> {
  performance.mark?.('knowledge-edit-validate-start');
  const errors = validateKnowledgeEdit(protocolNodesFromState(projection.state), edit);
  performance.mark?.('knowledge-edit-validate-end');
  performance.measure?.('knowledge-edit-validate', 'knowledge-edit-validate-start', 'knowledge-edit-validate-end');
  if (errors.length) throw new KnowledgeEditValidationError(errors);

  const type = eventTypeFor(edit);
  const timestamp = Date.now();
  const payload = type === 'KnowledgeAdded' && declaredLayers
    ? { edit, declaredLayers: { ...declaredLayers } }
    : { edit };
  const id = await fingerprint(type, payload, timestamp);
  const event = {
    id,
    type,
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp,
    payload,
  } as DomainEvent;

  performance.mark?.('knowledge-edit-append-start');
  const accepted = committer ? await committer(event) : store.appendValidated(event);
  if (!accepted) {
    throw new Error(`Duplicate knowledge edit event: ${id}`);
  }
  performance.mark?.('knowledge-edit-append-end');
  performance.measure?.('knowledge-edit-append', 'knowledge-edit-append-start', 'knowledge-edit-append-end');
  return event;
}
