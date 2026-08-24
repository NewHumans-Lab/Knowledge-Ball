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

/** A reasoning topic has two persistent semantic camps. */
export type ReasoningSide = 'normal' | 'opposition';

/**
 * A knowledge ball is immutable. This metadata describes where that immutable
 * ball currently sits relative to the topic's active head; it does not rewrite
 * the ball's title, layer, or content.
 */
export interface KnowledgeLineageMeta {
  /** Stable identity shared by all versions/opposition balls for one topic. */
  topicId: string;
  proposal: KnowledgeProposalKind;
  /** Ball that was current/dominant when an optimization/opposition proposal was created. */
  targetId?: string;
  role: KnowledgeLineageRole;
  /** current/candidates use 0; stable history/opposition use positive rank for legacy topics. */
  rank: number;
  /**
   * Reasoning-only two-camp identity. `normal` is the white camp; `opposition`
   * is the red camp. The head of each camp has side rank 0. Older versions on
   * either camp have positive side rank and are rendered gray.
   */
  reasoningSide?: ReasoningSide;
  reasoningSideRank?: number;
  /** Exactly one stable reasoning-side head is dominant and owns the logical chain. */
  reasoningDominant?: boolean;
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

export function reasoningSideFor(node: KnowledgeLineageNode): ReasoningSide | null {
  return node.lineage?.reasoningSide ?? null;
}

export function reasoningSideRankFor(node: KnowledgeLineageNode): number | null {
  return node.lineage?.reasoningSideRank ?? null;
}

export function isReasoningSideHead(node: KnowledgeLineageNode): boolean {
  const role = lineageRoleFor(node);
  return Boolean(
    node.lineage?.reasoningSide
      && node.lineage.reasoningSideRank === 0
      && (role === 'current' || role === 'opposition'),
  );
}

/**
 * Optimization and opposition both compete to replace a stable head. Until
 * explicit candidate-rebase semantics exist, a topic may have only one pending
 * head-changing candidate of either kind.
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

export function reasoningHeadForTopic<T extends KnowledgeLineageNode>(
  nodes: readonly T[],
  topicId: string,
  side: ReasoningSide,
): T | undefined {
  return nodes.find(node =>
    topicIdFor(node) === topicId
      && lineageRoleFor(node) !== 'rejected'
      && node.lineage?.reasoningSide === side
      && node.lineage.reasoningSideRank === 0
      && (lineageRoleFor(node) === 'current' || lineageRoleFor(node) === 'opposition'),
  );
}

/**
 * Logical-chain authority is independent from color for reasoning topics. A red
 * head may dominate while the white head remains white and present as the other
 * camp. Legacy/non-reasoning topics continue to use the ordinary current head.
 */
export function dominantNodeForTopic<T extends KnowledgeLineageNode>(
  nodes: readonly T[],
  topicId: string,
): T | undefined {
  const dominant = nodes.find(node =>
    topicIdFor(node) === topicId
      && isReasoningSideHead(node)
      && node.lineage?.reasoningDominant === true,
  );
  return dominant ?? currentNodeForTopic(nodes, topicId);
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

/** Reasoning history is side-local: white history stays behind white; red history stays behind red. */
export function reasoningHistoryChain<T extends KnowledgeLineageNode>(
  nodes: readonly T[],
  topicId: string,
  side: ReasoningSide,
): T[] {
  return nodes
    .filter(node =>
      topicIdFor(node) === topicId
        && lineageRoleFor(node) !== 'rejected'
        && node.lineage?.reasoningSide === side
        && Number.isSafeInteger(node.lineage.reasoningSideRank)
        && (node.lineage.reasoningSideRank ?? 0) > 0,
    )
    .sort((left, right) =>
      (left.lineage?.reasoningSideRank ?? Number.MAX_SAFE_INTEGER)
        - (right.lineage?.reasoningSideRank ?? Number.MAX_SAFE_INTEGER),
    );
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
    if (meta.reasoningSide && !Number.isSafeInteger(meta.reasoningSideRank)) {
      errors.push(`reasoning side node must have a safe side rank: ${node.id}`);
    }
    if (meta.reasoningSideRank !== undefined && !meta.reasoningSide) {
      errors.push(`reasoning side rank requires a reasoning side: ${node.id}`);
    }
    if ((meta.reasoningSideRank ?? 0) < 0) errors.push(`reasoning side rank must be non-negative: ${node.id}`);
    if (meta.reasoningDominant && (!meta.reasoningSide || meta.reasoningSideRank !== 0)) {
      errors.push(`only a reasoning side head may be dominant: ${node.id}`);
    }
  }

  for (const topicId of topicIds) {
    const members = nodes.filter(node => topicIdFor(node) === topicId);
    const activeMembers = members.filter(node => lineageRoleFor(node) !== 'rejected');
    const currents = activeMembers.filter(node => lineageRoleFor(node) === 'current');
    if (currents.length !== 1) errors.push(`topic must have exactly one current node: ${topicId}`);

    for (const role of ['history', 'opposition'] as const) {
      const usedRanks = new Map<number, string>();
      for (const node of activeMembers.filter(member => lineageRoleFor(member) === role)) {
        const rank = node.lineage?.rank ?? 0;
        const previous = usedRanks.get(rank);
        if (previous) errors.push(`${role} lineage cannot fork at rank ${rank}: ${previous}, ${node.id}`);
        else usedRanks.set(rank, node.id);
      }
    }

    const stableMembers = activeMembers.filter(node => {
      const role = lineageRoleFor(node);
      return role === 'current' || role === 'history' || role === 'opposition';
    });
    const dualSide = stableMembers.some(node => node.lineage?.reasoningSide !== undefined);
    if (!dualSide) continue;

    for (const node of stableMembers) {
      if (!node.lineage?.reasoningSide || node.lineage.reasoningSideRank === undefined) {
        errors.push(`reasoning dual-side topic must classify every stable member: ${topicId} / ${node.id}`);
      }
    }

    const normalHead = stableMembers.filter(node =>
      node.lineage?.reasoningSide === 'normal' && node.lineage.reasoningSideRank === 0,
    );
    const oppositionHead = stableMembers.filter(node =>
      node.lineage?.reasoningSide === 'opposition' && node.lineage.reasoningSideRank === 0,
    );
    if (normalHead.length !== 1 || lineageRoleFor(normalHead[0]!) !== 'current') {
      errors.push(`reasoning topic must have exactly one white normal head: ${topicId}`);
    }
    if (oppositionHead.length > 1 || (oppositionHead[0] && lineageRoleFor(oppositionHead[0]) !== 'opposition')) {
      errors.push(`reasoning topic may have at most one red opposition head: ${topicId}`);
    }

    const sideHeads = [...normalHead, ...oppositionHead];
    const dominantHeads = sideHeads.filter(node => node.lineage?.reasoningDominant === true);
    if (dominantHeads.length !== 1) errors.push(`reasoning topic must have exactly one dominant side head: ${topicId}`);

    for (const side of ['normal', 'opposition'] as const) {
      const usedSideRanks = new Map<number, string>();
      for (const node of stableMembers.filter(member => member.lineage?.reasoningSide === side)) {
        const sideRank = node.lineage?.reasoningSideRank;
        if (sideRank === undefined) continue;
        const previous = usedSideRanks.get(sideRank);
        if (previous) errors.push(`reasoning ${side} side cannot fork at rank ${sideRank}: ${previous}, ${node.id}`);
        else usedSideRanks.set(sideRank, node.id);
        if (sideRank > 0) {
          const expectedRole = side === 'normal' ? 'history' : 'opposition';
          if (lineageRoleFor(node) !== expectedRole) {
            errors.push(`reasoning ${side} history has invalid role: ${node.id}`);
          }
          if (node.lineage?.reasoningDominant) errors.push(`reasoning history cannot be dominant: ${node.id}`);
        }
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
