import { Projection } from './Projection';
import { Graph } from '../graph/Graph';
import { DomainEvent } from '../event/Event';

export class GraphProjection implements Projection<Graph> {
  apply(graph: Graph, event: DomainEvent): Graph {
    switch (event.command) {
      case 'CreateNode': {
        const p = event.payload as { nodeId: string; title: string; type: any; layer: string };
        graph.addNode({
          id: p.nodeId,
          title: p.title,
          type: p.type,
          layer: p.layer,
          status: 'Draft',
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
        });
        return graph;
      }

      case 'RenameNode': {
        const p = event.payload as { nodeId: string; title: string };
        const node = graph.nodes.get(p.nodeId);
        if (node) {
          node.title = p.title;
          node.updatedAt = event.timestamp;
        }
        return graph;
      }

      case 'VerifyNode': {
        const p = event.payload as { nodeId: string };
        const node = graph.nodes.get(p.nodeId);
        if (node) {
          node.status = 'Verified';
          node.updatedAt = event.timestamp;
        }
        return graph;
      }

      case 'SuspendNode': {
        // 级联失效：这是你架构里最有价值也最危险的部分
        const p = event.payload as { nodeId: string; reason: string };
        this.cascadeSuspend(graph, p.nodeId, p.reason, event.timestamp, new Set());
        return graph;
      }

      case 'AddEdge': {
        const p = event.payload as { edgeId: string; from: string; to: string; type: any };
        graph.addEdge({ id: p.edgeId, from: p.from, to: p.to, type: p.type });
        return graph;
      }

      default:
        return graph; // 未知事件类型直接忽略，不抛异常，保证 replay 不中断
    }
  }

  // 深度优先级联失效 + 环检测（visited）。你原设计完全没提环的处理，
  // 知识图谱里 A 依赖 B、B 又间接依赖 A 完全可能出现，不做 visited 会死循环
  private cascadeSuspend(
    graph: Graph,
    nodeId: string,
    reason: string,
    ts: number,
    visited: Set<string>
  ) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = graph.nodes.get(nodeId);
    if (!node) return;
    node.status = 'Suspended';
    node.suspendedReason = reason;
    node.updatedAt = ts;

    for (const depId of graph.getDependents(nodeId)) {
      this.cascadeSuspend(graph, depId, `upstream:${nodeId}`, ts, visited);
    }
  }
}