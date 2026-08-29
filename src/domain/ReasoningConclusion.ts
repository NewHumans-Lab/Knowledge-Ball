import type { NodeStatus } from '../event/Event';
import {
  lineageRoleFor,
  topicIdFor,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

/**
 * Minimal semantic shape needed to bind one reasoning ball to the one ordinary
 * Knowledge ball it serves as a conclusion. There is no dedicated conclusion
 * node type: any non-reasoning Knowledge ball may be that concrete conclusion.
 */
export interface ReasoningConclusionSemanticNode {
  id: string;
  type?: string;
  premises?: readonly string[];
  status?: NodeStatus;
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
}

/**
 * Runtime semantic projection copied onto one Reasoning ball. Geometry and
 * visibility consume the same concrete immutable conclusion identity.
 */
export interface ReasoningConclusionBinding {
  conclusionId: string;
  conclusionTopicId: string;
  status: NodeStatus;
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
}

type BoundReasoningNode = ReasoningConclusionSemanticNode & {
  reasoningConclusion?: ReasoningConclusionBinding;
};

type Resolution<T> = Readonly<{ conclusion?: T; error?: string }>;

function active(node: ReasoningConclusionSemanticNode | undefined): boolean {
  return Boolean(node && lineageRoleFor(node) !== 'rejected');
}

function directConclusionsFor<T extends ReasoningConclusionSemanticNode>(
  reasoningId: string,
  nodes: readonly T[],
): T[] {
  return nodes.filter(node =>
    node.type !== 'reasoning'
      && active(node)
      && (node.premises ?? []).includes(reasoningId),
  );
}

/**
 * Immutable conclusion optimization/opposition can leave multiple versions with
 * the same Reasoning ID in their stored premise lists. The Reasoning remains
 * owned by the concrete conclusion ball it was originally attached to, so among
 * those directly linked versions we walk to the lineage root instead of jumping
 * to the topic's newest Current ball.
 */
function directConcreteConclusion<T extends ReasoningConclusionSemanticNode>(
  reasoningId: string,
  nodes: readonly T[],
): Resolution<T> {
  const direct = directConclusionsFor(reasoningId, nodes);
  if (!direct.length) return {};

  const topicIds = [...new Set(direct.map(topicIdFor))].sort();
  if (topicIds.length !== 1) {
    return {
      error: `Reasoning node ${reasoningId} must serve exactly one concrete conclusion ball; found conclusion topics ${topicIds.join(', ')}`,
    };
  }

  if (direct.length === 1) return { conclusion: direct[0] };

  const directIds = new Set(direct.map(node => node.id));
  const roots = direct.filter(node => {
    const targetId = node.lineage?.targetId;
    return !targetId || !directIds.has(targetId);
  });
  if (roots.length === 1) return { conclusion: roots[0] };

  return {
    error: `Reasoning node ${reasoningId} must resolve to one concrete conclusion ball; found ${direct.map(node => node.id).sort().join(', ')}`,
  };
}

function resolveReasoningConclusionInternal<T extends ReasoningConclusionSemanticNode>(
  reasoning: T,
  nodes: readonly T[],
  byId: ReadonlyMap<string, T>,
  visiting: Set<string>,
): Resolution<T> {
  if (reasoning.type !== 'reasoning' || !active(reasoning)) return {};
  if (visiting.has(reasoning.id)) {
    return { error: `Reasoning conclusion inheritance cycle: ${reasoning.id}` };
  }
  visiting.add(reasoning.id);

  const direct = directConcreteConclusion(reasoning.id, nodes);
  if (direct.error || direct.conclusion) {
    visiting.delete(reasoning.id);
    return direct;
  }

  // Reasoning optimization/opposition/history nodes inherit the exact immutable
  // conclusion from the Reasoning ball they target. They never re-resolve by
  // conclusion topic and therefore cannot drift to a newer conclusion version.
  const targetId = reasoning.lineage?.targetId;
  const target = targetId ? byId.get(targetId) : undefined;
  if (target?.type === 'reasoning' && active(target)) {
    const inherited = resolveReasoningConclusionInternal(target, nodes, byId, visiting);
    visiting.delete(reasoning.id);
    return inherited;
  }

  visiting.delete(reasoning.id);
  return {};
}

export function resolveReasoningConclusion<T extends ReasoningConclusionSemanticNode>(
  reasoning: T | string,
  nodes: readonly T[],
): T | undefined {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const source = typeof reasoning === 'string' ? byId.get(reasoning) : reasoning;
  if (!source) return undefined;
  return resolveReasoningConclusionInternal(source, nodes, byId, new Set()).conclusion;
}

/**
 * Bind once per graph/layout generation. Each Reasoning ball gets one concrete
 * conclusion owner. Side/history variants inherit that exact owner through their
 * Reasoning target chain; conclusion-topic Current changes never retarget them.
 */
export function bindReasoningConclusions<T extends ReasoningConclusionSemanticNode>(nodes: T[]): void {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const cache = new Map<string, Resolution<T>>();

  const resolve = (node: T): Resolution<T> => {
    const cached = cache.get(node.id);
    if (cached) return cached;
    const result = resolveReasoningConclusionInternal(node, nodes, byId, new Set());
    cache.set(node.id, result);
    return result;
  };

  for (const node of nodes) {
    const mutable = node as T & BoundReasoningNode;
    if (node.type !== 'reasoning' || !active(node)) {
      delete mutable.reasoningConclusion;
      continue;
    }

    const result = resolve(node);
    const conclusion = result.conclusion;
    if (!conclusion || result.error) {
      delete mutable.reasoningConclusion;
      continue;
    }

    mutable.reasoningConclusion = Object.freeze({
      conclusionId: conclusion.id,
      conclusionTopicId: topicIdFor(conclusion),
      status: conclusion.status ?? 'verified',
      hidden: conclusion.hidden,
      lineage: conclusion.lineage ? { ...conclusion.lineage } : undefined,
    });
  }
}

export function reasoningConclusionBindingFor(
  node: ReasoningConclusionSemanticNode,
): ReasoningConclusionBinding | undefined {
  return (node as BoundReasoningNode).reasoningConclusion;
}

/** Domain-level audit helper used by regression/QA without making UI the validator. */
export function validateReasoningConclusionBindings<T extends ReasoningConclusionSemanticNode>(nodes: readonly T[]): string[] {
  const errors: string[] = [];
  const byId = new Map(nodes.map(node => [node.id, node] as const));

  for (const node of nodes) {
    if (node.type !== 'reasoning' || !active(node)) continue;
    const result = resolveReasoningConclusionInternal(node, nodes, byId, new Set());
    if (result.error) errors.push(result.error);
    else if (!result.conclusion) errors.push(`reasoning node must serve one concrete ordinary conclusion: ${node.id}`);
  }

  return [...new Set(errors)];
}
