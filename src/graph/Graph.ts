import type { GraphNode } from './Node';
import type { GraphEdge } from './Edge';

export function edgesFrom(nodes: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  nodes.forEach(n => {
    n.premises.forEach(p => edges.push({ from: p, to: n.id }));
    if (n.logicRuleId) edges.push({ from: n.logicRuleId, to: n.id });
  });
  return edges;
}
