import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type DomainEvent, type KnowledgeAddedEvent } from '../event/Event';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import { validateOptimizationProposal } from '../domain/KnowledgeOptimization';
import { topicIdFor } from '../domain/KnowledgeLineage';
import type { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';

export interface KnowledgeOptimizationInput {
  targetId: string;
  candidateId: string;
  title: string;
  reasoning: string;
  declaredLayer: UserKnowledgeLayer;
}

export class KnowledgeOptimizationValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('；'));
    this.name = 'KnowledgeOptimizationValidationError';
  }
}

/**
 * Validate the product-level optimization invariant without mutating the target.
 * Ordinary knowledge may optimize title, layer and content. A reasoning ball is
 * stricter: only its title and inference prose are editable; its layer and all
 * structural identity are inherited from the current version.
 */
export function validateKnowledgeOptimization(
  state: GraphState,
  input: KnowledgeOptimizationInput,
): string[] {
  return validateOptimizationProposal(Object.values(state.nodesById), input);
}

export async function executeKnowledgeOptimization(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  input: KnowledgeOptimizationInput,
  committer?: EventCommitter,
): Promise<KnowledgeAddedEvent> {
  const errors = validateKnowledgeOptimization(projection.state, input);
  if (errors.length) throw new KnowledgeOptimizationValidationError(errors);

  const target = projection.state.nodesById[input.targetId]!;
  const topicId = topicIdFor(target);
  const timestamp = Date.now();
  const candidateLayer = target.type === 'reasoning'
    ? (target.declaredLayer ?? input.declaredLayer)
    : input.declaredLayer;
  const edit = {
    kind: 'add' as const,
    mode: 'atomic' as const,
    node: {
      id: input.candidateId,
      title: input.title.trim(),
      type: target.type,
      reasoning: input.reasoning.trim(),
      logicRuleId: target.logicRuleId,
    },
  };
  const payload: KnowledgeAddedEvent['payload'] = {
    edit,
    declaredLayers: { [input.candidateId]: candidateLayer },
    optimization: { targetId: target.id, topicId },
  };
  const id = await fingerprint('KnowledgeAdded', payload, timestamp);
  const event: KnowledgeAddedEvent = {
    id,
    type: 'KnowledgeAdded',
    scope: 'public',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    timestamp,
    payload,
  };

  const accepted = committer ? await committer(event as DomainEvent) : store.appendValidated(event);
  if (!accepted) throw new Error(`Duplicate optimization event: ${id}`);
  return event;
}
