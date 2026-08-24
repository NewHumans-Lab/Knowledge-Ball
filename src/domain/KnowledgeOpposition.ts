import type { GraphNode } from '../graph/Node';
import {
  currentNodeForTopic,
  dominantNodeForTopic,
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

function inferredReasoningSide(node: GraphNode): ReasoningSide {
  const explicit = reasoningSideFor(node);
  if (explicit) return explicit;
  return lineageRoleFor(node) === 'opposition' ? 'opposition' : 'normal';
}

function oppositeReasoningSide(side: ReasoningSide): ReasoningSide {
  return side === 'normal' ? 'opposition' : 'normal';
}

export function oppositionCandidateLineage(target: GraphNode): KnowledgeLineageMeta {
  const base: KnowledgeLineageMeta = {
    topicId: topicIdFor(target),
    proposal: 'opposition',
    targetId: target.id,
    role: 'candidate-opposition',
    rank: 0,
  };
  if (target.type !== 'reasoning') return base;
  return {
    ...base,
    reasoningSide: oppositeReasoningSide(inferredReasoningSide(target)),
    reasoningSideRank: 0,
    reasoningDominant: false,
  };
}

export function isOppositionCandidate(node: GraphNode | undefined): node is OppositionCandidateNode {
  return Boolean(
    node?.lineage?.proposal === 'opposition'
    && node.lineage.role === 'candidate-opposition'
    && node.lineage.targetId,
  );
}

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

  const topicId = topicIdFor(target);
  if (target.type === 'reasoning') {
    const dominant = dominantNodeForTopic(nodes, topicId);
    const validHead = isReasoningSideHead(target) || lineageRoleFor(target) === 'current';
    if (!validHead || dominant?.id !== target.id) {
      errors.push('推理对立只能针对当前主导的白色或红色推理头');
    }
  } else if (lineageRoleFor(target) !== 'current') {
    errors.push('只能对当前版本发起新的否定观点');
  }

  if (!candidateId || candidateId !== input.candidateId) errors.push('否定候选必须有不含首尾空白的新节点 ID');
  else if (byId.has(candidateId)) errors.push(`否定候选节点 ID 已存在: ${candidateId}`);

  if (!title) errors.push('否定候选必须有名字');
  if (!reasoning) errors.push('否定候选必须有内容');
  if (title && nodes.some(node => canonicalText(node.title) === title)) {
    errors.push(`否定候选名字已被知识图使用: ${input.title.trim()}`);
  }

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

  const existingDominant = nodes.find(node =>
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
    reasoningDominant: existingDominant ? existingDominant.id === current.id : true,
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
      reasoningDominant: existingDominant ? existingDominant.id === node.id && index === 0 : false,
    };
    node.hidden = index !== 0;
  });
}

function promoteReasoningOppositionCandidate(
  nodes: GraphNode[],
  candidate: OppositionCandidateNode,
  target: GraphNode,
): string {
  const topicId = candidate.lineage.topicId;
  ensureReasoningTwoCampMetadata(nodes, topicId);

  const dominant = dominantNodeForTopic(nodes, topicId);
  if (!dominant || dominant.id !== target.id) {
    throw new Error(`Stale reasoning opposition target: expected ${dominant?.id ?? 'none'}, got ${candidate.lineage.targetId}`);
  }

  const targetSide = inferredReasoningSide(target);
  const candidateSide = candidate.lineage.reasoningSide ?? oppositeReasoningSide(targetSide);
  if (candidateSide === targetSide) throw new Error('Reasoning opposition candidate must belong to the opposite side');

  const targetHead = reasoningHeadForTopic(nodes, topicId, targetSide);
  if (!targetHead || targetHead.id !== target.id || !targetHead.lineage) {
    throw new Error(`Reasoning opposition target is not its side head: ${target.id}`);
  }
  targetHead.lineage = { ...targetHead.lineage, reasoningDominant: false };
  targetHead.hidden = false;

  const candidateNode: GraphNode = candidate;
  if (candidateSide === 'normal') {
    const oldHead = reasoningHeadForTopic(nodes, topicId, 'normal');
    if (!oldHead?.lineage) throw new Error(`Reasoning normal head missing: ${topicId}`);
    const oldHistory = reasoningHistoryChain(nodes, topicId, 'normal');
    oldHistory.forEach((node, index) => {
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
    oldHead.lineage = {
      ...oldHead.lineage,
      role: 'history',
      rank: 1,
      reasoningSide: 'normal',
      reasoningSideRank: 1,
      reasoningDominant: false,
    };
    oldHead.hidden = true;
    candidateNode.lineage = {
      ...candidate.lineage,
      role: 'current',
      rank: 0,
      reasoningSide: 'normal',
      reasoningSideRank: 0,
      reasoningDominant: true,
    };
  } else {
    const oldHead = reasoningHeadForTopic(nodes, topicId, 'opposition');
    const oldHistory = reasoningHistoryChain(nodes, topicId, 'opposition');
    const redVersions = oldHead ? [oldHead, ...oldHistory] : oldHistory;
    redVersions.forEach((node, index) => {
      if (!node.lineage) throw new Error(`Reasoning opposition history metadata missing: ${node.id}`);
      node.lineage = {
        ...node.lineage,
        role: 'opposition',
        rank: index + 2,
        reasoningSide: 'opposition',
        reasoningSideRank: index + 1,
        reasoningDominant: false,
      };
      node.hidden = true;
    });
    candidateNode.lineage = {
      ...candidate.lineage,
      role: 'opposition',
      rank: 1,
      reasoningSide: 'opposition',
      reasoningSideRank: 0,
      reasoningDominant: true,
    };
  }

  candidateNode.status = 'verified';
  candidateNode.hidden = false;
  assertValidLineage(nodes);
  return target.id;
}

/**
 * Reasoning nodes keep two persistent camps. White means “this inference is
 * valid”; red means “this inference is invalid”. Acceptance switches only
 * logical-chain dominance. Neither stable camp head changes color, and each camp
 * keeps its own gray version history behind it.
 */
export function promoteOppositionCandidate(nodes: GraphNode[], candidateId: string): string {
  const candidate = nodes.find(node => node.id === candidateId);
  if (!isOppositionCandidate(candidate)) throw new Error(`Not an opposition candidate: ${candidateId}`);

  const topicId = candidate.lineage.topicId;
  const target = nodes.find(node => node.id === candidate.lineage.targetId);
  if (!target) throw new Error(`Opposition target missing: ${candidate.lineage.targetId}`);

  if (target.type === 'reasoning') {
    return promoteReasoningOppositionCandidate(nodes, candidate, target);
  }

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
