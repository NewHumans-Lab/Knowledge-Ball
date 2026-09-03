import { fingerprint } from '../event/Command';
import {
  CURRENT_SCHEMA_VERSION,
  type DomainEvent,
} from '../event/Event';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor } from '../domain/KnowledgeLineage';
import { resolveReasoningConclusion } from '../domain/ReasoningConclusion';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { GraphNode } from '../graph/Node';
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

function canonicalTopicSet(state: GraphState, ids: readonly string[]): string[] {
  return [...new Set(ids.map(id => {
    const node = state.nodesById[id];
    return node ? topicIdFor(node) : id;
  }))].sort();
}

function sameCanonicalSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * A reasoning node is identified by its premise topics plus the exact immutable
 * conclusion ball it serves. Premise version changes therefore cannot create a
 * duplicate, while a different concrete conclusion version is intentionally a
 * different Reasoning relationship.
 */
export function findExistingReasoningForLink(
  state: GraphState,
  premiseIds: readonly string[],
  conclusionIds: readonly string[],
): GraphNode | null {
  if (conclusionIds.length !== 1) return null;
  const expectedPremises = canonicalTopicSet(state, premiseIds);
  const expectedConclusionId = conclusionIds[0]!;
  const nodes = Object.values(state.nodesById);

  for (const reasoning of nodes) {
    if (reasoning.type !== 'reasoning' || lineageRoleFor(reasoning) !== 'current') continue;
    const actualPremises = canonicalTopicSet(state, reasoning.premises);
    if (!sameCanonicalSet(actualPremises, expectedPremises)) continue;

    const concreteConclusion = resolveReasoningConclusion(reasoning, nodes);
    if (concreteConclusion?.id === expectedConclusionId) return reasoning;
  }
  return null;
}

function eventTypeFor(edit: KnowledgeEdit): DomainEvent['type'] {
  if (edit.kind === 'add') return 'KnowledgeAdded';
  return 'KnowledgeNegated';
}

/**
 * The only write boundary for add/negate. Validation runs against the complete
 * projection, including default-hidden historical nodes, before a single atomic
 * event is committed. Hosted callers may inject a server-first committer; tests
 * and unconfigured local sessions retain the direct EventStore path.
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
  if (edit.kind === 'add' && edit.mode === 'reasoning-link') {
    const existing = findExistingReasoningForLink(
      projection.state,
      edit.requiredPremiseIds,
      edit.conclusionIds,
    );
    if (existing) {
      errors.push(`推理节点已存在：${existing.title}（同样的前提与具体结论只能有一个推理节点）`);
    }
  }
  performance.mark?.('knowledge-edit-validate-end');
  performance.measure?.('knowledge-edit-validate', 'knowledge-edit-validate-start', 'knowledge-edit-validate-end');
  if (errors.length) throw new KnowledgeEditValidationError([...new Set(errors)]);

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
