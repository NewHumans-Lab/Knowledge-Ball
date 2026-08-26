import type { RadialKnowledgeLayoutNode } from './RadialKnowledgeLayout';
import {
  applyRadialKnowledgeLayout,
  placeReasoningAtRelationCenters,
} from './RadialKnowledgeLayout';
import { applyTriangularRelationGroupPacking } from './TriangularRelationGroupPacking';

/**
 * Runtime layout entry kept only so existing callers do not need unrelated
 * wiring changes. RadialKnowledgeLayout establishes the canonical 5R radial
 * planes. Same-plane knowledge nodes are then reassigned to discrete triangular
 * lattice cells by relation-group constraints, and reasoning balls are refreshed
 * afterwards from the final premise/conclusion geometry centres.
 */
export type UniformLayoutNode = RadialKnowledgeLayoutNode;

export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  applyRadialKnowledgeLayout(nodes);
  applyTriangularRelationGroupPacking(nodes);
  placeReasoningAtRelationCenters(nodes);
  return nodes;
}
