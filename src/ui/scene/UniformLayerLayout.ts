import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import {
  applyDeterministic5RLayout,
  type LayoutNode,
} from './Deterministic5RLayout';
import { applyOrdinaryLineagePlacement, isOrdinaryLineageSatellite } from './OrdinaryLineagePlacement';
import { applyReasoningRadialPlacement } from './ReasoningRadialPlacement';

export type UniformLayoutNode = LayoutNode;

/**
 * Runtime spatial boundary:
 * - rejected first-round proposals never enter Knowledge geometry;
 * - ordinary history/opposition/candidates are local lineage satellites and do
 *   not participate in the global main-chain occupancy/compactness search;
 * - Reasoning keeps its existing non-authoritative radial projection;
 * - ordinary lineage is projected last from the already-final current anchor.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  const globalMainChain = spatialKnowledge.filter(node => !isOrdinaryLineageSatellite(node));

  applyDeterministic5RLayout(globalMainChain);

  // Keep the current Reasoning behaviour isolated from this ordinary-lineage
  // change. It sees only the global main-chain geometry, never ordinary lineage
  // satellites, so red/white semantics remain a separate follow-up concern.
  applyReasoningRadialPlacement(globalMainChain);

  // Ordinary lineage owns its local straight-line geometry after the current
  // main-chain anchor is final. It may rotate as one rigid line, but compactness
  // can never bend or interleave history/opposition members.
  applyOrdinaryLineagePlacement(spatialKnowledge);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
