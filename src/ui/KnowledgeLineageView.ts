import type { KnowledgeLineageMeta } from '../domain/KnowledgeLineage';
import { lineageRoleFor } from '../domain/KnowledgeLineage';
import type { Mastery } from '../domain/KnowledgeModel';
import type { NodeStatus } from '../event/Event';

export type KnowledgeVisibilityMode = 'current' | 'personal' | 'all';

export interface KnowledgeLineageViewNode {
  id: string;
  status: NodeStatus;
  mastery: Mastery;
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
}

/** Stable presentation colors for relative lineage roles only. */
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

/**
 * The near-node detail is a temporary presentation lens, not a fourth global
 * visibility mode. When it is open, the selected ball and every canonical
 * related ball rendered around that detail are allowed into the 3D scene. The
 * scene's existing endpoint rule then makes their relation lines appear too.
 * Closing the detail removes this override and Current/Personal/All immediately
 * owns visibility again.
 */
export function nodeVisibleBecauseDetailIsOpen(nodeId: string): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.getElementById('nodeDetailOverlay');
  if (!root?.classList.contains('open')) return false;
  if (root.dataset.nodeId === nodeId) return true;
  return Array.from(root.querySelectorAll<HTMLElement>('[data-related-node-id]'))
    .some(element => element.dataset.relatedNodeId === nodeId);
}

/**
 * Scene data must retain formal lineage balls even when the legacy `hidden`
 * compatibility flag is true; the Current/Personal/All mode is the sole owner
 * of whether gray/red formal balls are normally visible. An open detail may
 * temporarily reveal only its own canonical relation context.
 */
export function nodeBelongsInLineageScene(node: KnowledgeLineageViewNode): boolean {
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;
  if (node.lineage) return true;
  return !node.hidden;
}

export function nodeVisibleInKnowledgeMode(
  node: KnowledgeLineageViewNode,
  mode: KnowledgeVisibilityMode,
  isCore = false,
): boolean {
  if (isCore) return true;
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;

  // Detail context is intentionally evaluated after the rejected guard: audit-
  // only rejected proposals must never be resurrected by presentation state.
  if (nodeVisibleBecauseDetailIsOpen(node.id)) return true;

  // Pending gray/red proposals are the deliberate mode exception: users must see
  // a proposal that is currently being judged regardless of the selected mode.
  if (isPendingLineageCandidate(node)) return true;

  if (mode === 'all') {
    return node.lineage ? true : !node.hidden;
  }

  if (mode === 'personal') {
    // Preserve the existing personal rule: untouched knowledge disappears.
    // A personally encountered historical/opposing version remains meaningful
    // personal history and is therefore visible here even though Current hides it.
    return node.mastery !== 'none' && (node.lineage ? true : !node.hidden);
  }

  // Current mode contains only the effective current ball for each topic.
  return role === 'current' && (node.lineage ? true : !node.hidden);
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

/** Color role is independent from validation/pending state. */
export function lineageColorForNode(node: Pick<KnowledgeLineageViewNode, 'id' | 'lineage'>): number | null {
  const role = lineageRoleFor(node);
  if (role === 'history' || role === 'candidate-history') return KNOWLEDGE_HISTORY_COLOR;
  if (role === 'opposition' || role === 'candidate-opposition') return KNOWLEDGE_OPPOSITION_COLOR;
  return null;
}

/** Pending creation and any active revalidation blink; role/color stays separate. */
export function nodeShouldPulse(node: Pick<KnowledgeLineageViewNode, 'status'>): boolean {
  return node.status === 'pending' || node.status === 'disputed';
}
