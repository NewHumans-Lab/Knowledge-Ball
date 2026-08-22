import type { GraphNode } from '../graph/Node';
import {
  currentNodeForTopic,
  isPendingHeadCandidate,
  lineageRoleFor,
  topicIdFor,
  validateKnowledgeLineage,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

export type KnowledgeOppositionVerdict = 'CORRECT' | 'INCORRECT';

export interface KnowledgeOppositionProposalInput {
  targetId: string;
  candidateId: string;
  title: string;
  reasoning: string;
}

type OppositionCandidateNode = GraphNode & {
  lineage: KnowledgeLineageMeta & {
    proposal: 'opposition';
    role: 'candidate-opposition';
    targetId: string;
  };
};

function canonicalText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function oppositionCandidateLineage(target: GraphNode): KnowledgeLineageMeta {
  return {
    topicId: topicIdFor(target),
    proposal: 'opposition',
    targetId: target.id,
    role: 'candidate-opposition',
    rank: 0,
  };
}

export function isOppositionCandidate(node: GraphNode | undefined): node is OppositionCandidateNode {
  return Boolean(
    node?.lineage?.proposal === 'opposition'
    && node.lineage.role === 'candidate-opposition'
    && node.lineage.targetId,
  );
}

/**
 * A new opposition is a distinct knowledge claim, so unlike an optimization it
 * receives no same-name exception. Name uniqueness remains global.
 */
export function validateOppositionProposal(
  nodes: readonly GraphNode[],
  input: KnowledgeOppositionProposalInput,
): string[] {
  const errors: string[] = [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const target = byId.get(input.targetId);
  const candidateId = input.candidateId.trim();
  const title = canonicalText(input.title);
  const reasoning = canonicalText(input.reasoning);

  if (!target) return [`否定目标不存在: ${input.targetId}`];
  if (target.status !== 'verified' || target.hidden || target.supersededBy) {
    errors.push('只能否定当前已验证且可见的有效知识');
  }
  if (lineageRoleFor(target) !== 'current') errors.push('只能对当前版本发起新的否定观点');

  if (!candidateId || candidateId !== input.candidateId) errors.push('否定候选必须有不含首尾空白的新节点 ID');
  else if (byId.has(candidateId)) errors.push(`否定候选节点 ID 已存在: ${candidateId}`);

  if (!title) errors.push('否定候选必须有名字');
  if (!reasoning) errors.push('否定候选必须有内容');
  if (title && nodes.some(node => canonicalText(node.title) === title)) {
    errors.push(`否定候选名字已被知识图使用: ${input.title.trim()}`);
  }

  const topicId = topicIdFor(target);
  if (nodes.some(node => topicIdFor(node) === topicId && isPendingHeadCandidate(node))) {
    errors.push('同一知识主题已有一个会改变当前版本的候选正在验证；当前节点必须串行推进');
  }

  return errors;
}

function assertValidLineage(nodes: readonly GraphNode[]): void {
  const errors = validateKnowledgeLineage(nodes);
  if (errors.length) throw new Error(`Invalid knowledge lineage after opposition transition: ${errors.join('; ')}`);
}

export function rejectOppositionCandidate(nodes: GraphNode[], candidateId: string): void {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOppositionCandidate(candidate)) throw new Error(`Not an opposition candidate: ${candidateId}`);
  const candidateNode: GraphNode = candidate;
  candidateNode.lineage = { ...candidate.lineage, role: 'rejected', rank: 0 };
  candidateNode.status = 'falsified';
  candidateNode.hidden = true;
  assertValidLineage(nodes);
}

/**
 * Final acceptance swaps the two viewpoint roles atomically in projection:
 * - previous current becomes nearest opposition;
 * - its history follows behind it on the opposition chain;
 * - the previously stable opposition chain becomes history of the winning side;
 * - the accepted candidate becomes the unique current head.
 */
export function promoteOppositionCandidate(nodes: GraphNode[], candidateId: string): string {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOppositionCandidate(candidate)) throw new Error(`Not an opposition candidate: ${candidateId}`);

  const topicId = candidate.lineage.topicId;
  const current = currentNodeForTopic(nodes, topicId);
  if (!current) throw new Error(`Opposition topic has no current node: ${topicId}`);
  if (current.id !== candidate.lineage.targetId) {
    throw new Error(`Stale opposition target: expected ${current.id}, got ${candidate.lineage.targetId}`);
  }

  const oldHistory = nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'history')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));
  const oldOpposition = nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'opposition')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));

  oldOpposition.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Opposition lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, role: 'history', rank: index + 1 };
    node.hidden = true;
  });

  const previousMeta = current.lineage ?? {
    topicId,
    proposal: 'new' as const,
    role: 'current' as const,
    rank: 0,
  };
  current.lineage = { ...previousMeta, topicId, role: 'opposition', rank: 1 };
  current.hidden = true;

  oldHistory.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Historical lineage metadata missing: ${node.id}`);
    node.lineage = { ...node.lineage, role: 'opposition', rank: index + 2 };
    node.hidden = true;
  });

  const candidateNode: GraphNode = candidate;
  candidateNode.lineage = { ...candidate.lineage, role: 'current', rank: 0 };
  candidateNode.status = 'verified';
  candidateNode.hidden = false;

  assertValidLineage(nodes);
  return current.id;
}

export function resolveOppositionCandidate(
  nodes: GraphNode[],
  candidateId: string,
  verdict: KnowledgeOppositionVerdict,
): string | null {
  if (verdict === 'INCORRECT') {
    rejectOppositionCandidate(nodes, candidateId);
    return null;
  }
  return promoteOppositionCandidate(nodes, candidateId);
}
