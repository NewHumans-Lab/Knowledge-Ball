import { fingerprint } from '../event/Command';
import { CURRENT_SCHEMA_VERSION, type DomainEvent, type KnowledgeAddedEvent } from '../event/Event';
import type { EventCommitter } from '../event/EventCommitter';
import type { EventStore } from '../event/EventStore';
import type { UserKnowledgeLayer } from '../domain/KnowledgeLayerPolicy';
import { validateOppositionProposal } from '../domain/KnowledgeOpposition';
import { topicIdFor } from '../domain/KnowledgeLineage';
import type { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';

export interface KnowledgeOppositionInput {
  targetId: string;
  candidateId: string;
  title: string;
  reasoning: string;
  declaredLayer: UserKnowledgeLayer;
}

export class KnowledgeOppositionValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('；'));
    this.name = 'KnowledgeOppositionValidationError';
  }
}

export function validateKnowledgeOpposition(
  state: GraphState,
  input: KnowledgeOppositionInput,
): string[] {
  return validateOppositionProposal(Object.values(state.nodesById), input);
}

/**
 * Submit a new opposing viewpoint without changing the current claim. The event
 * remains KnowledgeAdded so the existing authoritative V2 first-round funding
 * and verdict path applies. Only the final verdict is allowed to swap lineages.
 */
export async function executeKnowledgeOpposition(
  store: EventStore<GraphState>,
  projection: GraphProjection,
  input: KnowledgeOppositionInput,
  committer?: EventCommitter,
): Promise<KnowledgeAddedEvent> {
  const errors = validateKnowledgeOpposition(projection.state, input);
  if (errors.length) throw new KnowledgeOppositionValidationError(errors);

  const target = projection.state.nodesById[input.targetId]!;
  const topicId = topicIdFor(target);
  const timestamp = Date.now();
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
    declaredLayers: { [input.candidateId]: input.declaredLayer },
    opposition: { targetId: target.id, topicId },
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
  if (!accepted) throw new Error(`Duplicate opposition event: ${id}`);
  return event;
}
