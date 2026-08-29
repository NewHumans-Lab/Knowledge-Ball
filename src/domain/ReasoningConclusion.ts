import type { NodeStatus } from '../event/Event';
import {
  lineageRoleFor,
  topicIdFor,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

/**
 * Minimal semantic shape needed to bind one reasoning family to the ordinary
 * Knowledge ball it serves as a conclusion. Any ordinary Knowledge type may be
 * the conclusion; there is intentionally no dedicated conclusion node type.
 */
export interface ReasoningConclusionSemanticNode {
  id: string;
  type?: string;
  premises?: readonly string[];
  status?: NodeStatus;
  lineage?: KnowledgeLineageMeta;
}

/**
 * Runtime semantic projection copied onto every reasoning-family member.
 * Geometry and visibility both read this one binding instead of independently
 * rediscovering a conclusion.
 */
export interface ReasoningConclusionBinding {
  conclusionId: string;
  conclusionTopicId: string;
  status: NodeStatus;
  lineage?: KnowledgeLineageMeta;
}

type BoundReasoningNode = ReasoningConclusionSemanticNode & {
  reasoningConclusion?: ReasoningConclusionBinding;
};

function active(node: ReasoningConclusionSemanticNode): boolean {
  return lineageRoleFor(node) !== 'rejected';
}

function candidateRank(node: ReasoningConclusionSemanticNode): number {
  const role = lineageRoleFor(node);
  if (role === 'current') return -1;
  if (role === 'history' || role === 'opposition') return node.lineage?.rank ?? Number.MAX_SAFE_INTEGER;
  return Number.MAX_SAFE_INTEGER - 1;
}

function resolveReasoningConclusionForTopic<T extends ReasoningConclusionSemanticNode>(
  reasoningTopicId: string,
  nodes: readonly T[],
): T | undefined {
  const reasoningIds = new Set(
    nodes
      .filter(node => node.type === 'reasoning' && active(node) && topicIdFor(node) === reasoningTopicId)
      .map(node => node.id),
  );
  if (!reasoningIds.size) return undefined;

  const directConclusions = nodes.filter(node =>
    node.type !== 'reasoning'
      && active(node)
      && (node.premises ?? []).some(premiseId => reasoningIds.has(premiseId)),
  );
  if (!directConclusions.length) return undefined;

  const conclusionTopicIds = [...new Set(directConclusions.map(topicIdFor))].sort();
  if (conclusionTopicIds.length !== 1) {
    throw new Error(
      `Reasoning topic ${reasoningTopicId} must serve exactly one conclusion topic; found ${conclusionTopicIds.join(', ')}`,
    );
  }

  const current = directConclusions
    .filter(node => lineageRoleFor(node) === 'current')
    .sort((left, right) => left.id.localeCompare(right.id));
  if (current.length > 1) {
    throw new Error(
      `Reasoning topic ${reasoningTopicId} resolves to multiple current conclusion balls: ${current.map(node => node.id).join(', ')}`,
    );
  }
  if (current[0]) return current[0];

  // Compatibility for an older reasoning family after its original conclusion
  // has moved into history/opposition: keep following the nearest directly linked
  // immutable conclusion ball instead of silently jumping to an unrelated current.
  return [...directConclusions].sort((left, right) =>
    candidateRank(left) - candidateRank(right)
      || lineageRoleFor(left).localeCompare(lineageRoleFor(right))
      || left.id.localeCompare(right.id),
  )[0];
}

export function resolveReasoningConclusion<T extends ReasoningConclusionSemanticNode>(
  reasoning: T | string,
  nodes: readonly T[],
): T | undefined {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const source = typeof reasoning === 'string' ? byId.get(reasoning) : reasoning;
  if (!source || source.type !== 'reasoning' || !active(source)) return undefined;
  return resolveReasoningConclusionForTopic(topicIdFor(source), nodes);
}

/**
 * Bind once per graph/layout generation. All white/red/history reasoning balls in
 * one reasoning topic inherit the same served conclusion because they are
 * alternative reasoning processes for that conclusion, not independent outputs.
 */
export function bindReasoningConclusions<T extends ReasoningConclusionSemanticNode>(nodes: T[]): void {
  const cache = new Map<string, T | null>();
  for (const node of nodes) {
    const mutable = node as T & BoundReasoningNode;
    if (node.type !== 'reasoning' || !active(node)) {
      delete mutable.reasoningConclusion;
      continue;
    }

    const reasoningTopicId = topicIdFor(node);
    let conclusion = cache.get(reasoningTopicId);
    if (conclusion === undefined) {
      conclusion = resolveReasoningConclusionForTopic(reasoningTopicId, nodes) ?? null;
      cache.set(reasoningTopicId, conclusion);
    }

    if (!conclusion) {
      delete mutable.reasoningConclusion;
      continue;
    }

    mutable.reasoningConclusion = Object.freeze({
      conclusionId: conclusion.id,
      conclusionTopicId: topicIdFor(conclusion),
      status: conclusion.status ?? 'verified',
      lineage: conclusion.lineage ? { ...conclusion.lineage } : undefined,
    });
  }
}

export function reasoningConclusionBindingFor(
  node: ReasoningConclusionSemanticNode,
): ReasoningConclusionBinding | undefined {
  return (node as BoundReasoningNode).reasoningConclusion;
}

/** Domain-level audit helper used by regression/QA without making UI rendering the validator. */
export function validateReasoningConclusionBindings<T extends ReasoningConclusionSemanticNode>(nodes: readonly T[]): string[] {
  const errors: string[] = [];
  const topics = [...new Set(
    nodes
      .filter(node => node.type === 'reasoning' && active(node))
      .map(topicIdFor),
  )].sort();

  for (const topicId of topics) {
    try {
      if (!resolveReasoningConclusionForTopic(topicId, nodes)) {
        errors.push(`reasoning topic must serve one ordinary conclusion: ${topicId}`);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}
