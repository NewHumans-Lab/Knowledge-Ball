import { KnowledgeNode } from './Node';
import { KnowledgeEdge } from './Edge';

export class Graph {
  nodes = new Map<string, KnowledgeNode>();
  edges = new Map<string, KnowledgeEdge>();

  // 反向依赖索引：谁依赖了这个节点。Suspend 级联失效必须靠这个，
  // 否则每次 Invalidate 都要全图扫描，节点一多就是 O(n) 灾难
  private dependents = new Map<string, Set<string>>();

  addNode(node: KnowledgeNode) {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: KnowledgeEdge) {
    this.edges.set(edge.id, edge);
    if (edge.type === 'DependsOn') {
      if (!this.dependents.has(edge.to)) {
        this.dependents.set(edge.to, new Set());
      }
      this.dependents.get(edge.to)!.add(edge.from);
    }
  }

  getDependents(nodeId: string): string[] {
    return Array.from(this.dependents.get(nodeId) ?? []);
  }
}