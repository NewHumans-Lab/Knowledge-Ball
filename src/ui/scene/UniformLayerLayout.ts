import { lineageRoleFor } from '../../domain/KnowledgeLineage';
import { bindReasoningConclusions } from '../../domain/ReasoningConclusion';
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
 * - every Reasoning family is first bound semantically to the one ordinary
 *   Knowledge conclusion it serves; any ordinary Knowledge ball may be a conclusion;
 * - Current / unrelated ordinary Knowledge are solved by the global main-chain layout first;
 * - ordinary History/Opposition/candidates then occupy authoritative cells on
 *   Current's shell along a local 5R ISG coordinate line; if that line is blocked,
 *   nearby ordinary main-layout nodes are locally repacked because lineage wins;
 * - Reasoning remains non-authoritative and is projected only after its served
 *   conclusion has reached its final ordinary-Knowledge position.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  bindReasoningConclusions(nodes);

  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  const globalMainChain = spatialKnowledge.filter(node => !isOrdinaryLineageSatellite(node));

  applyDeterministic5RLayout(globalMainChain);

  // Ordinary lineage is solved after Current is fixed, but its members are not
  // free-floating satellites: every member receives a real shellID/cellID and
  // consumes a cell on the 5R shell coordinate line through Current. A blocked
  // line may locally move ordinary main-layout blockers, never Reasoning.
  applyOrdinaryLineagePlacement(spatialKnowledge);

  // Reasoning now receives the full post-lineage Knowledge set because the ball
  // it serves may itself be a gray/red ordinary lineage member. The semantic
  // binding decides which single conclusion owns it; geometry never averages
  // multiple conclusions or invents a separate owner.
  applyReasoningRadialPlacement(spatialKnowledge);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
