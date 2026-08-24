import type { GraphNode } from '../graph/Node';
import type { UserKnowledgeLayer } from './KnowledgeLayerPolicy';
import {
  currentNodeForTopic,
  isPendingHeadCandidate,
  isReasoningSideHead,
  lineageRoleFor,
  reasoningHeadForTopic,
  reasoningHistoryChain,
  reasoningSideFor,
  topicIdFor,
  validateKnowledgeLineage,
  type KnowledgeLineageMeta,
  type ReasoningSide,
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

function inferredReasoningSide(node: GraphNode): ReasoningSide {
  const explicit = reasoningSideFor(node);
  if (explicit) return explicit;
  return lineageRoleFor(node) === 'opposition' ? 'opposition' : 'normal';
}

export function optimizationCandidateLineage(target: GraphNode): KnowledgeLineageMeta {
  const base: KnowledgeLineageMeta = {
    topicId: topicIdFor(target),
    proposal: 'optimization',
    targetId: target.id,
    role: 'candidate-history',
    rank: 0,
  };
  if (target.type !== 'reasoning') return base;
  return {
    ...base,
    reasoningSide: inferredReasoningSide(target),
    reasoningSideRank: 0,
    // A pending optimization is not yet a side head; dominance transfers only
    // if the candidate is accepted.
    reasoningDominant: false,
  };
}

export function isOptimizationCandidate(node: GraphNode | undefined): node is OptimizationCandidateNode {
  return Boolean(
    node?.lineage?.proposal === 'optimization'
    && node.lineage.role === 'candidate-history'
    && node.lineage.targetId,
  );
}

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
  if (target.type === 'reasoning') {
    const validHead = isReasoningSideHead(target) || lineageRoleFor(target) === 'current';
    if (!validHead) errors.push('推理节点只能优化白色或红色派系的当前头，不能直接优化灰色历史');
  } else if (lineageRoleFor(target) !== 'current') {
    errors.push('只能优化当前版本，不能直接编辑历史、对立或候选版本');
  }

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
  candidateNode.lineage = { ...candidate.lineage, role: 'rejected', rank: 0, reasoningDominant: false };
  candidateNode.status = 'falsified';
  candidateNode.hidden = true;
  assertValidLineage(nodes);
}

function ensureReasoningTwoCampMetadata(nodes: GraphNode[], topicId: string): void {
  const current = currentNodeForTopic(nodes, topicId);
  if (!current) throw new Error(`Reasoning topic has no white current head: ${topicId}`);
  const normalHistory = nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'history')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));
  const opposition = nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'opposition')
    .sort((left, right) => (left.lineage?.rank ?? 0) - (right.lineage?.rank ?? 0));
  const explicitDominant = nodes.find(node =>
    topicIdFor(node) === topicId
      && isReasoningSideHead(node)
      && node.lineage?.reasoningDominant === true,
  );

  const currentMeta = current.lineage ?? { topicId, proposal: 'new' as const, role: 'current' as const, rank: 0 };
  current.lineage = {
    ...currentMeta,
    topicId,
    role: 'current',
    rank: 0,
    reasoningSide: 'normal',
    reasoningSideRank: 0,
    reasoningDominant: explicitDominant ? explicitDominant.id === current.id : true,
  };
  current.hidden = false;

  normalHistory.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Historical lineage metadata missing: ${node.id}`);
    node.lineage = {
      ...node.lineage,
      role: 'history',
      rank: index + 1,
      reasoningSide: 'normal',
      reasoningSideRank: index + 1,
      reasoningDominant: false,
    };
    node.hidden = true;
  });

  opposition.forEach((node, index) => {
    if (!node.lineage) throw new Error(`Opposition lineage metadata missing: ${node.id}`);
    node.lineage = {
      ...node.lineage,
      role: 'opposition',
      rank: index + 1,
      reasoningSide: 'opposition',
      reasoningSideRank: index,
      reasoningDominant: explicitDominant ? explicitDominant.id === node.id && index === 0 : false,
    };
    node.hidden = index !== 0;
  });
}

function promoteReasoningOptimizationCandidate(
  nodes: GraphNode[],
  candidate: OptimizationCandidateNode,
  target: GraphNode,
): string {
  const topicId = candidate.lineage.topicId;
  ensureReasoningTwoCampMetadata(nodes, topicId);
  const side = candidate.lineage.reasoningSide ?? inferredReasoningSide(target);
  const head = reasoningHeadForTopic(nodes, topicId, side);
  if (!head || head.id !== target.id || !head.lineage) {
    throw new Error(`Stale reasoning optimization target: expected ${head?.id ?? 'none'}, got ${candidate.lineage.targetId}`);
  }

  const wasDominant = head.lineage.reasoningDominant === true;
  const history = reasoningHistoryChain(nodes, topicId, side);
  const candidateNode: GraphNode = candidate;

  if (side === 'normal') {
    history.forEach((node, index) => {
      if (!node.lineage) throw new Error(`Reasoning normal history metadata missing: ${node.id}`);
      node.lineage = {
        ...node.lineage,
        role: 'history',
        rank: index + 2,
        reasoningSide: 'normal',
        reasoningSideRank: index + 2,
        reasoningDominant: false,
      };
      node.hidden = true;
    });
    head.lineage = {
      ...head.lineage,
      role: 'history',
      rank: 1,
      reasoningSide: 'normal',
      reasoningSideRank: 1,
      reasoningDominant: false,
    };
    head.hidden = true;
    candidateNode.lineage = {
      ...candidate.lineage,
      role: 'current',
      rank: 0,
      reasoningSide: 'normal',
      reasoningSideRank: 0,
      reasoningDominant: wasDominant,
    };
  } else {
    history.forEach((node, index) => {
      if (!node.lineage) throw new Error(`Reasoning opposition history metadata missing: ${node.id}`);
      node.lineage = {
        ...node.lineage,
        role: 'opposition',
        rank: index + 3,
        reasoningSide: 'opposition',
        reasoningSideRank: index + 2,
        reasoningDominant: false,
      };
      node.hidden = true;
    });
    head.lineage = {
      ...head.lineage,
      role: 'opposition',
      rank: 2,
      reasoningSide: 'opposition',
      reasoningSideRank: 1,
      reasoningDominant: false,
    };
    head.hidden = true;
    candidateNode.lineage = {
      ...candidate.lineage,
      role: 'opposition',
      rank: 1,
      reasoningSide: 'opposition',
      reasoningSideRank: 0,
      reasoningDominant: wasDominant,
    };
  }

  candidateNode.status = 'verified';
  candidateNode.hidden = false;
  assertValidLineage(nodes);
  return target.id;
}

export function promoteOptimizationCandidate(nodes: GraphNode[], candidateId: string): string {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOptimizationCandidate(candidate)) throw new Error(`Not an optimization candidate: ${candidateId}`);

  const target = nodes.find(node => node.id === candidate.lineage.targetId);
  if (!target) throw new Error(`Optimization target missing: ${candidate.lineage.targetId}`);
  if (target.type === 'reasoning') {
    return promoteReasoningOptimizationCandidate(nodes, candidate, target);
  }

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
