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

export function dependentsOf(nodeId: string, nodes: GraphNode[]): GraphNode[] {
  return nodes.filter(n => n.premises.includes(nodeId) || n.logicRuleId === nodeId);
}

export function cascadeReachable(
  startId: string,
  nodes: GraphNode[],
  depthLimit = Infinity
): { ids: string[]; truncated: boolean } {
  const visited = new Set<string>([startId]);
  let frontier = [startId];
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0 && depth < depthLimit) {
    depth++;
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of dependentsOf(id, nodes)) {
        if (!visited.has(dep.id)) {
          visited.add(dep.id);
          next.push(dep.id);
        }
      }
    }
    frontier = next;
  }
  if (frontier.length > 0 && depth >= depthLimit) truncated = true;

  visited.delete(startId);
  return { ids: Array.from(visited), truncated };
}
