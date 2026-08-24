export type KnowledgeProposalKind = 'new' | 'optimization' | 'opposition';

/**
 * `current`, `history`, and `opposition` are formal lineage positions.
 * Candidate roles are pending proposals and are not part of either stable chain
 * until a final verdict promotes them. Rejected proposals remain audit-only.
 */
export type KnowledgeLineageRole =
  | 'current'
  | 'history'
  | 'opposition'
  | 'candidate-history'
  | 'candidate-opposition'
  | 'rejected';

/**
 * A knowledge ball is immutable. This metadata describes where that immutable
 * ball currently sits relative to the topic's active head; it does not rewrite
 * the ball's title, layer, or content.
 */
export interface KnowledgeLineageMeta {
  /** Stable identity shared by all versions/opposition balls for one topic. */
  topicId: string;
  proposal: KnowledgeProposalKind;
  /** Ball that was current when an optimization/opposition proposal was created. */
  targetId?: string;
  role: KnowledgeLineageRole;
  /** current/candidates use 0; stable history/opposition use positive distance from current. */
  rank: number;
  /**
   * A successful opposition to a reasoning node means that reasoning relation
   * should not currently exist. The topic therefore intentionally has no white
   * current head: the winning opposition stays red and every former accepted
   * reasoning version is gray. Such balls are audit-visible only in All mode.
   */
  suppressedByOpposition?: boolean;
}

export interface KnowledgeLineageNode {
  id: string;
  lineage?: KnowledgeLineageMeta;
}

export interface KnowledgeLineageStatusNode extends KnowledgeLineageNode {
  status?: string;
}

/** Legacy balls predate explicit lineage metadata and form a one-ball topic. */
export function topicIdFor(node: KnowledgeLineageNode): string {
  return node.lineage?.topicId ?? node.id;
}

/** Legacy balls are current heads of their own one-ball topic. */
export function lineageRoleFor(node: KnowledgeLineageNode): KnowledgeLineageRole {
  return node.lineage?.role ?? 'current';
}

export function isSuppressedByOpposition(node: KnowledgeLineageNode): boolean {
  return node.lineage?.suppressedByOpposition === true;
}

/**
 * Optimization and opposition both compete to replace the same unique current
 * head. Until explicit candidate-rebase semantics exist, a topic may have only
 * one pending head-changing candidate of either kind.
 */
export function isPendingHeadCandidate(node: KnowledgeLineageStatusNode): boolean {
  if (node.status !== 'pending') return false;
  const role = lineageRoleFor(node);
  return role === 'candidate-history' || role === 'candidate-opposition';
}

export function initialLineage(nodeId: string): KnowledgeLineageMeta {
  return { topicId: nodeId, proposal: 'new', role: 'current', rank: 0 };
}

export function currentNodeForTopic<T extends KnowledgeLineageNode>(
  nodes: readonly T[],
  topicId: string,
): T | undefined {
  return nodes.find(node => topicIdFor(node) === topicId && lineageRoleFor(node) === 'current');
}

/** Nearest stable version is first. Candidates and rejected audit records are excluded. */
export function stableLineageChain<T extends KnowledgeLineageNode>(
  nodes: readonly T[],
  topicId: string,
  role: 'history' | 'opposition',
): T[] {
  return nodes
    .filter(node => topicIdFor(node) === topicId && lineageRoleFor(node) === role)
    .sort((left, right) => (left.lineage?.rank ?? Number.MAX_SAFE_INTEGER) - (right.lineage?.rank ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Validate only lineage topology/identity. Validation, energy, DAG propagation,
 * visibility, and UI policy deliberately live in later modules.
 */
export function validateKnowledgeLineage(nodes: readonly KnowledgeLineageNode[]): string[] {
  const errors: string[] = [];
  const byId = new Map<string, KnowledgeLineageNode>();
  const topicIds = new Set<string>();

  for (const node of nodes) {
    if (!node.id) {
      errors.push('knowledge lineage node id cannot be empty');
      continue;
    }
    if (byId.has(node.id)) errors.push(`duplicate knowledge node id: ${node.id}`);
    byId.set(node.id, node);
    topicIds.add(topicIdFor(node));

    const meta = node.lineage;
    if (!meta) continue;
    if (!meta.topicId.trim()) errors.push(`lineage topicId cannot be empty: ${node.id}`);
    if (!Number.isSafeInteger(meta.rank) || meta.rank < 0) errors.push(`lineage rank must be a non-negative safe integer: ${node.id}`);
    if (meta.role === 'current' && meta.rank !== 0) errors.push(`current lineage node must have rank 0: ${node.id}`);
    if ((meta.role === 'history' || meta.role === 'opposition') && meta.rank < 1) {
      errors.push(`stable ${meta.role} node must have positive rank: ${node.id}`);
    }
    if ((meta.role === 'candidate-history' || meta.role === 'candidate-opposition') && meta.rank !== 0) {
      errors.push(`pending lineage candidate must have rank 0: ${node.id}`);
    }
    if ((meta.proposal === 'optimization' || meta.proposal === 'opposition') && !meta.targetId) {
      errors.push(`${meta.proposal} lineage node must identify its target: ${node.id}`);
    }
  }

  for (const topicId of topicIds) {
    const members = nodes.filter(node => topicIdFor(node) === topicId);
    const activeMembers = members.filter(node => lineageRoleFor(node) !== 'rejected');
    const currents = activeMembers.filter(node => lineageRoleFor(node) === 'current');
    const suppressedCount = activeMembers.filter(isSuppressedByOpposition).length;
    const suppressedTopic = activeMembers.length > 0 && suppressedCount === activeMembers.length;

    if (suppressedCount > 0 && !suppressedTopic) {
      errors.push(`suppressed lineage topic must mark every active member: ${topicId}`);
    }

    if (suppressedTopic) {
      if (currents.length !== 0) errors.push(`suppressed topic must have no current node: ${topicId}`);
      const winningOpposition = activeMembers.find(node =>
        lineageRoleFor(node) === 'opposition'
        && node.lineage?.rank === 1
        && node.lineage?.proposal === 'opposition',
      );
      if (!winningOpposition) errors.push(`suppressed topic must have a rank-1 winning opposition: ${topicId}`);
    } else if (currents.length !== 1) {
      errors.push(`topic must have exactly one current node: ${topicId}`);
    }

    for (const role of ['history', 'opposition'] as const) {
      const usedRanks = new Map<number, string>();
      for (const node of activeMembers.filter(member => lineageRoleFor(member) === role)) {
        const rank = node.lineage?.rank ?? 0;
        const previous = usedRanks.get(rank);
        if (previous) errors.push(`${role} lineage cannot fork at rank ${rank}: ${previous}, ${node.id}`);
        else usedRanks.set(rank, node.id);
      }
    }
  }

  for (const node of nodes) {
    const targetId = node.lineage?.targetId;
    if (!targetId) continue;
    const target = byId.get(targetId);
    if (!target) {
      errors.push(`lineage target does not exist: ${node.id} -> ${targetId}`);
      continue;
    }
    if (topicIdFor(target) !== topicIdFor(node)) {
      errors.push(`lineage target must belong to the same topic: ${node.id} -> ${targetId}`);
    }
  }

  return errors;
}
