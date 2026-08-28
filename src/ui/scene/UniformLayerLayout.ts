import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import {
  applyDeterministic5RLayout,
  type LayoutNode,
} from './Deterministic5RLayout';

export type UniformLayoutNode = LayoutNode;

/**
 * Runtime spatial boundary: failed proposals are not Knowledge and therefore
 * cannot affect ISG components, semantic boundaries, occupancy, exclusion, or
 * authoritative shell/cell addresses. The explicit cleanup also prevents a
 * legacy rejected object from retaining stale spatial state from an older run.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  applyDeterministic5RLayout(spatialKnowledge);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
