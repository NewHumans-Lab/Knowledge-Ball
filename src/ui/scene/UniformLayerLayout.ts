import type { RadialKnowledgeLayoutNode } from './RadialKnowledgeLayout';
import { applyRadialKnowledgeLayout } from './RadialKnowledgeLayout';
import { applyLocalChainLengthOptimization } from './LocalChainLengthOptimizer';

/**
 * Runtime layout entry kept only so existing callers do not need unrelated
 * wiring changes. RadialKnowledgeLayout establishes the canonical 5R layers and
 * initial triangular packing; the bounded local optimizer may then shorten
 * relation edges without changing those radial layers or the 5R minimum spacing.
 */
export type UniformLayoutNode = RadialKnowledgeLayoutNode;

export function applyUniformLayerLayout<T extends UniformLayoutNode>(nodes: T[]): T[] {
  applyRadialKnowledgeLayout(nodes);
  return applyLocalChainLengthOptimization(nodes);
}
