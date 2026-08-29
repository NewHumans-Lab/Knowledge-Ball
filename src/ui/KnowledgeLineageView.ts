import type { KnowledgeLineageMeta } from '../domain/KnowledgeLineage';
import { isReasoningSideHead, lineageRoleFor } from '../domain/KnowledgeLineage';
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
  /** Runtime layout projection; authoritative semantic nodes do not persist it. */
  pos?: unknown;
}

type PersonalRestrictionNode = Pick<KnowledgeLineageViewNode, 'id' | 'status' | 'lineage'>;

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

export function isPendingLineageCandidate(node: KnowledgeLineageViewNode): boolean {
  if (node.status !== 'pending') return false;
  const role = lineageRoleFor(node);
  return role === 'candidate-history' || role === 'candidate-opposition';
}

export function nodeVisibleBecauseDetailIsOpen(nodeId: string): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.getElementById('nodeDetailOverlay');
  if (!root?.classList.contains('open')) return false;
  if (root.dataset.nodeId === nodeId) return true;
  return Array.from(root.querySelectorAll<HTMLElement>('[data-related-node-id]'))
    .some(element => element.dataset.relatedNodeId === nodeId);
}

export function nodeBelongsInLineageScene(node: KnowledgeLineageViewNode): boolean {
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;
  // A real Reasoning without one concrete conclusion has no legal semantic/spatial
  // owner. Tests may temporarily recolor an already-positioned ordinary node as
  // reasoning after layout, hence the `pos` compatibility exception.
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
  if (nodeVisibleBecauseDetailIsOpen(node.id)) return true;
  return nodeNormallyVisibleInCurrent(node);
}

export function edgeVisibleInKnowledgeMode(
  from: KnowledgeLineageViewNode | undefined,
  to: KnowledgeLineageViewNode | undefined,
  mode: KnowledgeVisibilityMode,
  geometryVisible: boolean,
  isCore: (id: string) => boolean,
): boolean {
  return Boolean(
    geometryVisible
      && from
      && to
      && nodeVisibleInKnowledgeMode(from, mode, isCore(from.id))
      && nodeVisibleInKnowledgeMode(to, mode, isCore(to.id)),
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