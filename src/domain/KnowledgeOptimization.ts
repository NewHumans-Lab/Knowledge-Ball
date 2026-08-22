import type { GraphNode } from '../graph/Node';
import {
  currentNodeForTopic,
  lineageRoleFor,
  topicIdFor,
  validateKnowledgeLineage,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

export type KnowledgeOptimizationVerdict = 'CORRECT' | 'INCORRECT';

export function optimizationCandidateLineage(target: GraphNode): KnowledgeLineageMeta {
  return {
    topicId: topicIdFor(target),
    proposal: 'optimization',
    targetId: target.id,
    role: 'candidate-history',
    rank: 0,
  };
}

export function isOptimizationCandidate(node: GraphNode | undefined): node is GraphNode {
  return Boolean(
    node?.lineage?.proposal === 'optimization'
    && node.lineage.role === 'candidate-history'
    && node.lineage.targetId,
  );
}

function assertValidLineage(nodes: readonly GraphNode[]): void {
  const errors = validateKnowledgeLineage(nodes);
  if (errors.length) throw new Error(`Invalid knowledge lineage after optimization transition: ${errors.join('; ')}`);
}

export function rejectOptimizationCandidate(nodes: GraphNode[], candidateId: string): void {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOptimizationCandidate(candidate)) throw new Error(`Not an optimization candidate: ${candidateId}`);
  candidate.lineage = { ...candidate.lineage, role: 'rejected', rank: 0 };
  candidate.status = 'falsified';
  candidate.hidden = true;
  assertValidLineage(nodes);
}

export function promoteOptimizationCandidate(nodes: GraphNode[], candidateId: string): string {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOptimizationCandidate(candidate)) throw new Error(`Not an optimization candidate: ${candidateId}`);

  const topicId = candidate.lineage.topicId;
  const current = currentNodeForTopic(nodes, topicId);
  if (!current) throw new Error(`Optimization topic has no current node: ${topicId}`);
  if (current.id !== candidate.lineage.targetId) {
    throw new Error(`Stale optimization target: expected ${current.id}, got ${candidate.lineage.targetId}`);
  }

  for (const node of nodes) {
    if (topicIdFor(node) !== topicId || lineageRoleFor(node) !== 'history') continue;
    if (!node.lineage) throw new Error(`Historical lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, rank: node.lineage.rank + 1 };
    node.hidden = true;
  }

  const previousMeta = current.lineage ?? {
    topicId,
    proposal: 'new' as const,
    role: 'current' as const,
    rank: 0,
  };
  current.lineage = { ...previousMeta, topicId, role: 'history', rank: 1 };
  current.hidden = true;

  candidate.lineage = { ...candidate.lineage, role: 'current', rank: 0 };
  candidate.status = 'verified';
  candidate.hidden = false;

  assertValidLineage(nodes);
  return current.id;
}

export function resolveOptimizationCandidate(
  nodes: GraphNode[],
  candidateId: string,
  verdict: KnowledgeOptimizationVerdict,
): string | null {
  if (verdict === 'INCORRECT') {
    rejectOptimizationCandidate(nodes, candidateId);
    return null;
  }
  return promoteOptimizationCandidate(nodes, candidateId);
}
