import {
  dominantNodeForTopic,
  isReasoningSideHead,
  lineageRoleFor,
  topicIdFor,
  type KnowledgeLineageMeta,
} from '../domain/KnowledgeLineage';
import {
  reasoningConclusionBindingFor,
  type ReasoningConclusionBinding,
} from '../domain/ReasoningConclusion';
import type { Mastery } from '../domain/KnowledgeModel';
import type { NodeStatus } from '../event/Event';

export type KnowledgeVisibilityMode = 'current' | 'personal' | 'all';

export interface KnowledgeLineageViewNode {
  id: string;
  type?: string;
  status: NodeStatus;
  mastery: Mastery;
  createdByMe?: boolean;
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
  reasoningConclusion?: ReasoningConclusionBinding;
  /** Runtime-only topology guard; true only when canonical relation degree is zero. */
  reasoningIsolated?: boolean;
  /** Runtime layout projection; authoritative semantic nodes do not persist it. */
  pos?: unknown;
}

export interface KnowledgeDisplayLabelNode {
  id: string;
  title: string;
  lineage?: KnowledgeLineageMeta;
}

type PersonalRestrictionNode = Pick<KnowledgeLineageViewNode, 'id' | 'status' | 'lineage'>;
type DisplayBranch = 1 | 2;

export const KNOWLEDGE_HISTORY_COLOR = 0x8A949E;
export const KNOWLEDGE_OPPOSITION_COLOR = 0xEE5B63;

export function nextKnowledgeVisibilityMode(mode: KnowledgeVisibilityMode): KnowledgeVisibilityMode {
  if (mode === 'current') return 'personal';
  if (mode === 'personal') return 'all';
  return 'current';
}

export function visibilityModeLabel(mode: KnowledgeVisibilityMode): string {
  if (mode === 'current') return '当前';
  if (mode === 'personal') return '个人';
  return '全部';
}

function canonicalDisplayTitle(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function displayBranchFor(node: KnowledgeDisplayLabelNode): DisplayBranch | null {
  if (node.lineage?.reasoningSide === 'normal') return 1;
  if (node.lineage?.reasoningSide === 'opposition') return 2;

  const role = lineageRoleFor(node);
  if (role === 'history' || role === 'candidate-history') return 1;
  if (role === 'opposition' || role === 'candidate-opposition') return 2;
  if (role === 'current') return node.lineage?.proposal === 'opposition' ? 2 : 1;
  return null;
}

function displayDepthFor(node: KnowledgeDisplayLabelNode): number {
  const sideRank = node.lineage?.reasoningSideRank;
  if (Number.isSafeInteger(sideRank) && (sideRank ?? -1) >= 0) return sideRank!;
  const rank = node.lineage?.rank;
  if (Number.isSafeInteger(rank) && (rank ?? -1) >= 0) return rank!;
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Build presentation-only labels for ambiguous names inside one lineage topic.
 * The immutable knowledge title is never rewritten. A title is numbered only
 * when the same canonical title occurs at least twice in the same topic.
 *
 * Branch 1 = normal/history side; branch 2 = opposition side. The dominant ball
 * always keeps the bare title. Non-dominant side heads/pending candidates use
 * `.0`; historical same-name members are numbered contiguously from `.1`, so
 * unrelated differently named versions never create gaps in the visible suffix.
 */
export function buildKnowledgeDisplayLabelMap<T extends KnowledgeDisplayLabelNode>(
  nodes: readonly T[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>(nodes.map(node => [node.id, node.title]));
  const groups = new Map<string, { topicId: string; members: T[] }>();

  for (const node of nodes) {
    if (lineageRoleFor(node) === 'rejected') continue;
    const titleKey = canonicalDisplayTitle(node.title);
    if (!titleKey) continue;
    const topicId = topicIdFor(node);
    const key = `${topicId}\0${titleKey}`;
    const group = groups.get(key);
    if (group) group.members.push(node);
    else groups.set(key, { topicId, members: [node] });
  }

  for (const { topicId, members } of groups.values()) {
    if (members.length < 2) continue;
    const dominant = dominantNodeForTopic(nodes, topicId);
    const branchMembers = new Map<DisplayBranch, T[]>([[1, []], [2, []]]);

    for (const node of members) {
      if (node.id === dominant?.id) continue;
      const branch = displayBranchFor(node);
      if (branch) branchMembers.get(branch)!.push(node);
    }

    for (const branch of [1, 2] as const) {
      const ordered = branchMembers.get(branch)!;
      ordered.sort((left, right) =>
        displayDepthFor(left) - displayDepthFor(right) || left.id.localeCompare(right.id),
      );
      if (!ordered.length) continue;

      let ordinal = ordered.some(node => displayDepthFor(node) === 0) ? 0 : 1;
      for (const node of ordered) {
        labels.set(node.id, `${node.title}${branch}.${ordinal}`);
        ordinal += 1;
      }
    }
  }

  return labels;
}

export function displayKnowledgeLabelForNode<T extends KnowledgeDisplayLabelNode>(
  node: T,
  nodes: readonly T[],
): string {
  return buildKnowledgeDisplayLabelMap(nodes).get(node.id) ?? node.title;
}

export function isPendingLineageCandidate(node: KnowledgeLineageViewNode): boolean {
  if (node.status !== 'pending') return false;
  const role = lineageRoleFor(node);
  return role === 'candidate-history' || role === 'candidate-opposition';
}

export function nodeVisibleBecauseDetailIsOpen(nodeId: string, detailVisibleIds?: ReadonlySet<string>): boolean {
  return detailVisibleIds?.has(nodeId) ?? false;
}

export function nodeBelongsInLineageScene(node: KnowledgeLineageViewNode): boolean {
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;
  // Isolation is a topology fact, not a geometry fact. Only a Reasoning node
  // explicitly proven to have zero canonical relation edges is removed. A valid
  // connected Reasoning may still rely on the scene's temporary position fallback
  // if dedicated Reasoning geometry is unavailable in a particular generation.
  if (node.type === 'reasoning' && node.reasoningIsolated === true) return false;
  // Preserve the existing protection against truly unbound/free-floating records.
  if (node.type === 'reasoning' && !reasoningConclusionBindingFor(node) && !node.pos) return false;
  if (node.lineage) return true;
  return !node.hidden;
}

/** Legacy helper retained for callers/tests. Pending/disputed are not Personal bans. */
export function nodeRestrictedInPersonalMode(node: PersonalRestrictionNode): boolean {
  const lineageColor = lineageColorForNode(node);
  return node.status === 'falsified'
    || lineageColor === KNOWLEDGE_HISTORY_COLOR
    || lineageColor === KNOWLEDGE_OPPOSITION_COLOR;
}

/**
 * Current-mode conclusion gate used by Reasoning. Pending has the highest visual
 * priority and therefore remains visible even when another field would normally
 * hide the ball. Otherwise only the ordinary Current ball is a visible conclusion.
 */
export function conclusionVisibleInCurrent(binding: ReasoningConclusionBinding): boolean {
  if (binding.status === 'pending') return true;
  if (binding.hidden || binding.status === 'falsified') return false;
  return (binding.lineage?.role ?? 'current') === 'current';
}

/** Current visibility without the temporary detail-overlay presentation lens. */
export function nodeNormallyVisibleInCurrent(
  node: KnowledgeLineageViewNode,
  reasoningConclusion = node.type === 'reasoning' ? reasoningConclusionBindingFor(node) : undefined,
): boolean {
  // Highest-priority rule: every legitimate pending ball is visible in Current.
  if (node.status === 'pending') return true;

  if (node.type === 'reasoning') {
    if (!reasoningConclusion || !conclusionVisibleInCurrent(reasoningConclusion)) return false;
    if (!isReasoningSideHead(node)) return false;

    // Current represents a surviving valid inference only. A dominant white head
    // is visible; if the red/opposition head wins, the entire stable Reasoning
    // family disappears from Current. All mode still renders both camps/history.
    if (node.lineage?.reasoningSide) {
      return node.lineage.reasoningSide === 'normal'
        && node.lineage.reasoningDominant === true;
    }
    return lineageRoleFor(node) === 'current' && !node.hidden;
  }

  return lineageRoleFor(node) === 'current' && !node.hidden;
}

export function nodeVisibleInKnowledgeMode(
  node: KnowledgeLineageViewNode,
  mode: KnowledgeVisibilityMode,
  isCore = false,
  detailVisibleIds?: ReadonlySet<string>,
): boolean {
  if (isCore) return true;
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;

  const reasoningConclusion = node.type === 'reasoning'
    ? reasoningConclusionBindingFor(node)
    : undefined;
  if (node.type === 'reasoning' && !reasoningConclusion && !node.pos) return false;

  if (mode === 'all') return node.lineage ? true : !node.hidden;

  if (mode === 'personal') {
    // Reasoning is always subordinate to its concrete conclusion. If that
    // conclusion is gray/red/hidden in the normal Current projection, no white,
    // red, winning, losing, owned, or mastered Reasoning may leak into Personal.
    if (node.type === 'reasoning' && (!reasoningConclusion || !conclusionVisibleInCurrent(reasoningConclusion))) {
      return false;
    }

    // Personal = my own submissions, plus lit nodes that normally belong in
    // Current. Ownership may expose my own history/failed Reasoning only while
    // its concrete conclusion passes the gate above.
    if (node.createdByMe) return true;
    if (node.mastery === 'none') return false;
    return nodeNormallyVisibleInCurrent(node, reasoningConclusion);
  }

  // Current: pending visibility is absolute and precedes conclusion/dominance,
  // history, hidden-state, and detail-presentation rules.
  if (node.status === 'pending') return true;

  // Non-pending Reasoning has no detail-overlay escape hatch: if its conclusion
  // is hidden, it is losing/history, or the red camp has won, Current keeps the
  // whole stable Reasoning family hidden.
  if (node.type === 'reasoning') return nodeNormallyVisibleInCurrent(node, reasoningConclusion);

  // Ordinary gray/red related balls may still be temporarily revealed by an
  // opened detail, preserving the existing detail-navigation presentation.
  if (nodeVisibleBecauseDetailIsOpen(node.id, detailVisibleIds)) return true;
  return nodeNormallyVisibleInCurrent(node);
}

export function edgeVisibleInKnowledgeMode(
  from: KnowledgeLineageViewNode | undefined,
  to: KnowledgeLineageViewNode | undefined,
  mode: KnowledgeVisibilityMode,
  geometryVisible: boolean,
  isCore: (id: string) => boolean,
  detailVisibleIds?: ReadonlySet<string>,
): boolean {
  return Boolean(
    geometryVisible
      && from
      && to
      && nodeVisibleInKnowledgeMode(from, mode, isCore(from.id), detailVisibleIds)
      && nodeVisibleInKnowledgeMode(to, mode, isCore(to.id), detailVisibleIds),
  );
}

/**
 * Reasoning color is camp-stable at side rank 0: normal is white/structural,
 * opposition is red. Older versions on either side are gray. Pending candidates
 * keep their semantic side/history color even though Current visibility is forced.
 */
export function lineageColorForNode(node: Pick<KnowledgeLineageViewNode, 'id' | 'lineage'>): number | null {
  const role = lineageRoleFor(node);
  const side = node.lineage?.reasoningSide;
  const sideRank = node.lineage?.reasoningSideRank;
  if (side && sideRank !== undefined) {
    if (sideRank > 0 || role === 'candidate-history') return KNOWLEDGE_HISTORY_COLOR;
    if (side === 'opposition') return KNOWLEDGE_OPPOSITION_COLOR;
    return null;
  }
  if (role === 'history' || role === 'candidate-history') return KNOWLEDGE_HISTORY_COLOR;
  if (role === 'opposition' || role === 'candidate-opposition') return KNOWLEDGE_OPPOSITION_COLOR;
  return null;
}

export function nodeShouldPulse(node: Pick<KnowledgeLineageViewNode, 'status'>): boolean {
  return node.status === 'pending' || node.status === 'disputed';
}
