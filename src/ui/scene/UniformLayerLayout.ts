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
 *   Current's shell along a local 5R ISG coordinate line; if that line is blocked,
 *   nearby ordinary main-layout nodes are locally repacked because lineage wins;
 * - Reasoning keeps its existing non-authoritative radial projection and is
 *   projected only after ordinary Knowledge positions are final.
 */
export function applyUniformLayerLayout(nodes: LayoutNode[]): void {
  const spatialKnowledge = nodes.filter(node => lineageRoleFor(node) !== 'rejected');
  const globalMainChain = spatialKnowledge.filter(node => !isOrdinaryLineageSatellite(node));

  applyDeterministic5RLayout(globalMainChain);

  // Ordinary lineage is solved after Current is fixed, but its members are not
  // free-floating satellites: every member receives a real shellID/cellID and
  // consumes a cell on the 5R shell coordinate line through Current. A blocked
  // line may locally move ordinary main-layout blockers, never Reasoning.
  applyOrdinaryLineagePlacement(spatialKnowledge);

  // Keep Reasoning semantics unchanged. Only its projection timing follows the
  // final ordinary Knowledge geometry so a local ordinary reflow cannot leave a
  // stale red/white position behind. History/opposition satellites still do not
  // enter the Reasoning input set.
  applyReasoningRadialPlacement(globalMainChain);

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'rejected') continue;
    delete node.address;
    delete node.pos;
    delete node.homePos;
    node.vel?.set(0, 0, 0);
  }
}
