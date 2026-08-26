import type { RadialKnowledgeLayoutNode } from './RadialKnowledgeLayout';
import { applyRadialKnowledgeLayout } from './RadialKnowledgeLayout';

/**
 * Runtime layout entry kept only so existing callers do not need unrelated
 * wiring changes. The former uniform-layer / relation-length implementation has
 * been retired; all node geometry is now owned by RadialKnowledgeLayout.
 */
export type UniformLayoutNode = RadialKnowledgeLayoutNode;

export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  return applyRadialKnowledgeLayout(nodes);
}
