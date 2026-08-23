import type { GraphNode } from '../graph/Node';
import type { UserKnowledgeLayer } from './KnowledgeLayerPolicy';
import {
  currentNodeForTopic,
  isPendingHeadCandidate,
  lineageRoleFor,
  topicIdFor,
  validateKnowledgeLineage,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

export type KnowledgeOptimizationVerdict = 'CORRECT' | 'INCORRECT';

export interface KnowledgeOptimizationProposalInput {
  targetId: string;
  candidateId: string;
  title: string;
  reasoning: string;
  declaredLayer?: UserKnowledgeLayer;
}

type OptimizationCandidateNode = GraphNode & {
  lineage: KnowledgeLineageMeta & {
    proposal: 'optimization';
    role: 'candidate-history';
    targetId: string;
  };
};

function canonicalText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function optimizationCandidateLineage(target: GraphNode): KnowledgeLineageMeta {
  return {
    topicId: topicIdFor(target),
    proposal: 'optimization',
    targetId: target.id,
    role: 'candidate-history',
    rank: 0,
  };
}

export function isOptimizationCandidate(node: GraphNode | undefined): node is OptimizationCandidateNode {
  return Boolean(
    node?.lineage?.proposal === 'optimization'
    && node.lineage.role === 'candidate-history'
    && node.lineage.targetId,
  );
}

/**
 * Product-level optimization guard. It intentionally permits the candidate to
 * keep exactly the current target title, while every genuinely new title still
 * participates in the repository-wide uniqueness rule.
 *
 * Reasoning balls have a stricter invariant: their endpoint structure and layer
 * define the same inference object, so optimization may change only title and
 * inference prose. Premises, conclusions, type, logic-rule identity and layer are
 * inherited and cannot be edited through optimization.
 */
export function validateOptimizationProposal(
  nodes: readonly GraphNode[],
  input: KnowledgeOptimizationProposalInput,
): string[] {
  const errors: string[] = [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const target = byId.get(input.targetId);
  const candidateId = input.candidateId.trim();
  const title = canonicalText(input.title);
  const reasoning = canonicalText(input.reasoning);

  if (!target) return [`优化目标不存在: ${input.targetId}`];
  if (target.status !== 'verified' || target.hidden || target.supersededBy) {
    errors.push('只能优化当前已验证且可见的有效知识');
  }
  if (lineageRoleFor(target) !== 'current') errors.push('只能优化当前版本，不能直接编辑历史、对立或候选版本');

  if (!candidateId || candidateId !== input.candidateId) errors.push('优化候选必须有不含首尾空白的新节点 ID');
  else if (byId.has(candidateId)) errors.push(`优化候选节点 ID 已存在: ${candidateId}`);

  if (!title) errors.push('优化候选必须有名字');
  if (!reasoning) errors.push(target.type === 'reasoning' ? '优化推理节点必须填写推理过程' : '优化候选必须有内容');

  if (
    target.type === 'reasoning'
    && target.declaredLayer
    && input.declaredLayer
    && input.declaredLayer !== target.declaredLayer
  ) {
    errors.push('推理节点优化只能修改名字和推理过程，知识层级必须保持不变');
  }

  const targetTitle = canonicalText(target.title);
  if (title && title !== targetTitle) {
    const duplicate = nodes.find(node => canonicalText(node.title) === title);
    if (duplicate) errors.push(`优化后的新名字已被其他知识节点使用: ${input.title.trim()}`);
  }

  const topicId = topicIdFor(target);
  if (nodes.some(node => topicIdFor(node) === topicId && isPendingHeadCandidate(node))) {
    errors.push('同一知识主题已有一个会改变当前版本的候选正在验证；当前节点必须串行推进');
  }

  return errors;
}

function assertValidLineage(nodes: readonly GraphNode[]): void {
  const errors = validateKnowledgeLineage(nodes);
  if (errors.length) throw new Error(`Invalid knowledge lineage after optimization transition: ${errors.join('; ')}`);
}

export function rejectOptimizationCandidate(nodes: GraphNode[], candidateId: string): void {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOptimizationCandidate(candidate)) throw new Error(`Not an optimization candidate: ${candidateId}`);
  const candidateNode: GraphNode = candidate;
  candidateNode.lineage = { ...candidate.lineage, role: 'rejected', rank: 0 };
  candidateNode.status = 'falsified';
  candidateNode.hidden = true;
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

  const candidateNode: GraphNode = candidate;
  candidateNode.lineage = { ...candidate.lineage, role: 'current', rank: 0 };
  candidateNode.status = 'verified';
  candidateNode.hidden = false;

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
