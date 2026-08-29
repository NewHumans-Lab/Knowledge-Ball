import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import { bindReasoningConclusions } from '../../domain/ReasoningConclusion';
import {
  applyDeterministic5RLayout,
  getLastLayoutDiagnostics,
  type LayoutNode,
} from './Deterministic5RLayout';
import { isOrdinaryLineageSatellite } from './OrdinaryLineagePlacement';
import {
  commitOrdinaryLineageFootprints,
  createOrdinaryLineageFootprintPlanner,
  ordinaryLineageFootprintSignature,
} from './OrdinaryLineageFootprint';
import { applyReasoningRadialPlacement } from './ReasoningRadialPlacement';

export type UniformLayoutNode = LayoutNode;

/**
 * Runtime spatial boundary:
 * - rejected first-round proposals never enter Knowledge geometry;
 * - every Reasoning family is first bound semantically to the one ordinary
 *   Knowledge conclusion it serves; any ordinary Knowledge ball may be a conclusion;
 * - ordinary History/Opposition/candidates are solved first as a local 5R
 *   shell-coordinate footprint around their Current anchor candidate;
 * - the unchanged global main-chain solver then evaluates Current/unrelated
 *   Knowledge with those local footprint cells already reserved, so real-edge
 *   compactness and 5R preference are optimized with lineage present from the
 *   start instead of being disturbed by a later insertion/reflow;
 * - Reasoning remains non-authoritative and is projected only after final
 *   ordinary-Knowledge geometry is committed.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  bindReasoningConclusions(nodes);

  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  const globalMainChain = spatialKnowledge.filter(node => !isOrdinaryLineageSatellite(node));
  const footprintPlanner = createOrdinaryLineageFootprintPlanner(spatialKnowledge);
  const footprintSignature = ordinaryLineageFootprintSignature(spatialKnowledge);

  applyDeterministic5RLayout(globalMainChain, { footprintPlanner, footprintSignature });
  commitOrdinaryLineageFootprints(spatialKnowledge, getLastLayoutDiagnostics());

  // Reasoning receives the full final Knowledge set because the concrete ball it
  // serves may itself be a gray/red ordinary lineage member. Geometry never
  // averages multiple conclusions or invents a separate owner.
  applyReasoningRadialPlacement(spatialKnowledge);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
