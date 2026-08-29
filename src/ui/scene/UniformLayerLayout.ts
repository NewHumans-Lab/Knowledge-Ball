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
 * - Current / unrelated ordinary Knowledge are solved by the global main-chain layout first;
 * - ordinary History/Opposition/candidates then occupy authoritative cells on
 *   Current's shell along a local 5R ISG coordinate line;
 * - Reasoning keeps its existing non-authoritative radial projection and is not
 *   changed by this ordinary-lineage rule.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  const globalMainChain = spatialKnowledge.filter(node => !isOrdinaryLineageSatellite(node));

  applyDeterministic5RLayout(globalMainChain);

  // Keep the current Reasoning behaviour isolated from this ordinary-lineage
  // change. It sees only the global main-chain geometry, so red/white semantics
  // remain a separate follow-up concern.
  applyReasoningRadialPlacement(globalMainChain);

  // Ordinary lineage is solved after Current is fixed, but its members are not
  // free-floating satellites: every member receives a real shellID/cellID and
  // consumes a cell on the 5R shell coordinate line through Current.
  applyOrdinaryLineagePlacement(spatialKnowledge);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
