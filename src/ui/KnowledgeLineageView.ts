import type { KnowledgeLineageMeta } from '../domain/KnowledgeLineage';
import { isReasoningSideHead, lineageRoleFor } from '../domain/KnowledgeLineage';
import type { Mastery } from '../domain/KnowledgeModel';
import type { NodeStatus } from '../event/Event';

export type KnowledgeVisibilityMode = 'current' | 'personal' | 'all';

export interface KnowledgeLineageViewNode {
  id: string;
  status: NodeStatus;
  mastery: Mastery;
  createdByMe?: boolean;
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
}

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
  if (node.lineage) return true;
  return !node.hidden;
}

export function nodeRestrictedInPersonalMode(node: KnowledgeLineageViewNode): boolean {
  const lineageColor = lineageColorForNode(node);
  return node.status === 'pending'
    || node.status === 'disputed'
    || node.status === 'falsified'
    || lineageColor === KNOWLEDGE_HISTORY_COLOR
    || lineageColor === KNOWLEDGE_OPPOSITION_COLOR;
}

export function nodeVisibleInKnowledgeMode(
  node: KnowledgeLineageViewNode,
  mode: KnowledgeVisibilityMode,
  isCore = false,
): boolean {
  if (isCore) return true;
  const role = lineageRoleFor(node);
  if (role === 'rejected') return false;

  if (mode === 'personal') {
    const belongsInScene = node.lineage ? true : !node.hidden;
    if (!belongsInScene) return false;
    if (node.createdByMe) return true;
    if (nodeRestrictedInPersonalMode(node)) return false;
    return node.mastery !== 'none';
  }

  // An opened detail is a temporary presentation lens in Current/All only.
  // Personal remains a strict private projection and does not leak non-owned
  // gray/red/validating nodes merely because another detail is open.
  if (nodeVisibleBecauseDetailIsOpen(node.id)) return true;

  // Pending lineage proposals remain globally visible while being judged, but
  // Personal handled them above using the ownership exception.
  if (isPendingLineageCandidate(node)) return true;

  if (mode === 'all') return node.lineage ? true : !node.hidden;

  // Reasoning is the deliberate Current-mode exception: both stable camp heads
  // remain visible so white="reasoning valid" and red="reasoning invalid" keep
  // permanent meaning. Dominance is shown by which head owns the logical chain,
  // not by recoloring or hiding the other head. Gray histories stay hidden.
  if (isReasoningSideHead(node)) return true;
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

/**
 * Reasoning color is camp-stable at side rank 0: normal is white/structural,
 * opposition is red. Older versions on either side are gray. Pending
 * optimization candidates retain the existing gray candidate treatment.
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
