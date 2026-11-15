import type { NodeStatus } from '../event/Event';
import {
  currentNodeForTopic,
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
 * visibility consume the same effective Current conclusion version.
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

function directConclusionsIndex<T extends ReasoningConclusionSemanticNode>(nodes: readonly T[]): ReadonlyMap<string, readonly T[]> {
  const result = new Map<string, T[]>();
  for (const node of nodes) {
    if (node.type === 'reasoning' || !active(node)) continue;
    for (const premiseId of node.premises ?? []) {
      const conclusions = result.get(premiseId);
      if (conclusions) conclusions.push(node);
      else result.set(premiseId, [node]);
    }
  }
  return result;
}

/**
 * Stored immutable premise lists may still mention an older conclusion version.
 * Resolve that historical endpoint through its topic to the single Current ball,
 * matching the canonical logical-edge projection used by the graph renderer.
 * The old version remains available in All mode, but it is never the effective
 * conclusion owner while a newer Current version exists.
 */
function currentConclusionsIndex<T extends ReasoningConclusionSemanticNode>(
  nodes: readonly T[],
): ReadonlyMap<string, T> {
  const byTopic = new Map<string, T[]>();
  for (const node of nodes) {
    if (node.type === 'reasoning' || !active(node)) continue;
    const topicId = topicIdFor(node);
    const members = byTopic.get(topicId);
    if (members) members.push(node);
    else byTopic.set(topicId, [node]);
  }

  const result = new Map<string, T>();
  for (const [topicId, members] of byTopic) {
    const current = currentNodeForTopic(members, topicId);
    if (current) result.set(topicId, current);
  }
  return result;
}

function directConcreteConclusion<T extends ReasoningConclusionSemanticNode>(
  reasoningId: string,
  currentConclusionsByTopic: ReadonlyMap<string, T>,
  conclusionsByReasoningId: ReadonlyMap<string, readonly T[]>,
): Resolution<T> {
  const direct = [...(conclusionsByReasoningId.get(reasoningId) ?? [])];
  if (!direct.length) return {};

  const topicIds = [...new Set(direct.map(topicIdFor))].sort();
  if (topicIds.length !== 1) {
    return {
      error: `Reasoning node ${reasoningId} must serve exactly one conclusion topic; found ${topicIds.join(', ')}`,
    };
  }

  const current = currentConclusionsByTopic.get(topicIds[0]!);
  if (current && current.type !== 'reasoning' && active(current)) {
    return { conclusion: current };
  }

  return {
    error: `Reasoning node ${reasoningId} has no active Current conclusion in topic ${topicIds[0]}`,
  };
}

function resolveReasoningConclusionInternal<T extends ReasoningConclusionSemanticNode>(
  reasoning: T,
  byId: ReadonlyMap<string, T>,
  currentConclusionsByTopic: ReadonlyMap<string, T>,
  conclusionsByReasoningId: ReadonlyMap<string, readonly T[]>,
  cache: Map<string, Resolution<T>>,
  visiting: Set<string>,
): Resolution<T> {
  const cached = cache.get(reasoning.id);
  if (cached) return cached;
  if (reasoning.type !== 'reasoning' || !active(reasoning)) return {};
  if (visiting.has(reasoning.id)) {
    return { error: `Reasoning conclusion inheritance cycle: ${reasoning.id}` };
  }
  visiting.add(reasoning.id);

  const direct = directConcreteConclusion(reasoning.id, currentConclusionsByTopic, conclusionsByReasoningId);
  if (direct.error || direct.conclusion) {
    visiting.delete(reasoning.id);
    cache.set(reasoning.id, direct);
    return direct;
  }

  // Reasoning optimization/opposition/history nodes inherit their target's
  // effective conclusion topic. Resolution still follows that topic's Current
  // ball, so a conclusion optimization retargets the whole reasoning family.
  const targetId = reasoning.lineage?.targetId;
  const target = targetId ? byId.get(targetId) : undefined;
  if (target?.type === 'reasoning' && active(target)) {
    const inherited = resolveReasoningConclusionInternal(target, byId, currentConclusionsByTopic, conclusionsByReasoningId, cache, visiting);
    visiting.delete(reasoning.id);
    // A cycle error names the first repeated node for this resolution root.
    // Sharing that root-relative error through the generation cache would make
    // later validation entries report the earlier root instead of themselves.
    // Successful/empty resolutions are root-independent and remain memoized.
    if (!inherited.error) cache.set(reasoning.id, inherited);
    return inherited;
  }

  visiting.delete(reasoning.id);
  const empty = {};
  cache.set(reasoning.id, empty);
  return empty;
}

export function resolveReasoningConclusion<T extends ReasoningConclusionSemanticNode>(
  reasoning: T | string,
  nodes: readonly T[],
): T | undefined {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const conclusionsByReasoningId = directConclusionsIndex(nodes);
  const source = typeof reasoning === 'string' ? byId.get(reasoning) : reasoning;
  if (!source) return undefined;
  return resolveReasoningConclusionInternal(source, byId, currentConclusionsIndex(nodes), conclusionsByReasoningId, new Map(), new Set()).conclusion;
}

/**
 * Bind once per graph/layout generation. Each Reasoning ball resolves to the
 * Current conclusion of its single conclusion topic. Side/history variants
 * inherit that effective owner through their Reasoning target chain.
 */
export function bindReasoningConclusions<T extends ReasoningConclusionSemanticNode>(nodes: T[]): void {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const conclusionsByReasoningId = directConclusionsIndex(nodes);
  const currentConclusionsByTopic = currentConclusionsIndex(nodes);
  const cache = new Map<string, Resolution<T>>();

  const resolve = (node: T): Resolution<T> => {
    return resolveReasoningConclusionInternal(node, byId, currentConclusionsByTopic, conclusionsByReasoningId, cache, new Set());
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
  const conclusionsByReasoningId = directConclusionsIndex(nodes);
  const cache = new Map<string, Resolution<T>>();

  for (const node of nodes) {
    if (node.type !== 'reasoning' || !active(node)) continue;
    const result = resolveReasoningConclusionInternal(node, byId, currentConclusionsByTopic, conclusionsByReasoningId, cache, new Set());
    if (result.error) errors.push(result.error);
    else if (!result.conclusion) errors.push(`reasoning node must serve one concrete ordinary conclusion: ${node.id}`);
  }

  return [...new Set(errors)];
}
