import type { KnowledgeSceneNode } from '../scene/KnowledgeScene';

export interface GraphProjectionOptions {
  nodes: () => KnowledgeSceneNode[];
}

export interface GraphProjectionResult {
  visibleNodes: KnowledgeSceneNode[];
  visibleEdges: Array<{
    from: string;
    to: string;
    type: 'dependency' | 'twin';
  }>;
}

export class GraphProjection {
  private readonly getNodes: () => KnowledgeSceneNode[];

  private selectedNodeId: string | null = null;
  private cascadeDepthLimit: number | null = null;

  constructor(options: GraphProjectionOptions) {
    this.getNodes = options.nodes;
  }

  setSelectedNode(id: string | null): void {
    this.selectedNodeId = id;
  }

  setCascadeDepthLimit(depth: number | null): void {
    this.cascadeDepthLimit = depth;
  }

  getProjection(): GraphProjectionResult {
    const nodes = this.getNodes();

    if (!this.selectedNodeId) {
      return {
        visibleNodes: nodes,
        visibleEdges: this.buildEdges(nodes),
      };
    }

    const visibleIds = this.collectRelatedNodes(
      this.selectedNodeId,
      this.cascadeDepthLimit
    );

    const visibleNodes = nodes.filter(n => visibleIds.has(n.id));

    return {
      visibleNodes,
      visibleEdges: this.buildEdges(visibleNodes),
    };
  }

  private collectRelatedNodes(
    startId: string,
    maxDepth: number | null
  ): Set<string> {
    const result = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [
      {
        id: startId,
        depth: 0,
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (result.has(current.id)) continue;

      result.add(current.id);

      if (
        maxDepth !== null &&
        current.depth >= maxDepth
      ) {
        continue;
      }

      const node = this.getNodes().find(
        n => n.id === current.id
      );

      if (!node) continue;

      // 前置依赖
      node.premises.forEach(id => {
        queue.push({
          id,
          depth: current.depth + 1,
        });
      });
      if (node.logicRuleId) {
        queue.push({ id: node.logicRuleId, depth: current.depth + 1 });
      }

      // 被当前节点依赖的节点
      this.getNodes()
        .filter(n =>
          n.premises.includes(current.id) || n.logicRuleId === current.id
        )
        .forEach(n => {
          queue.push({
            id: n.id,
            depth: current.depth + 1,
          });
        });

      // 双生节点
      if (node.twinGroup) {
        this.getNodes()
          .filter(
            n =>
              n.twinGroup === node.twinGroup
          )
          .forEach(n => {
            queue.push({
              id: n.id,
              depth: current.depth + 1,
            });
          });
      }
    }

    return result;
  }


  private buildEdges(
    nodes: KnowledgeSceneNode[]
  ) {
    const ids = new Set(
      nodes.map(n => n.id)
    );

    const edges: GraphProjectionResult['visibleEdges'] = [];

    nodes.forEach(node => {
      node.premises.forEach(parent => {
        if (!ids.has(parent)) return;

        edges.push({
          from: parent,
          to: node.id,
          type: 'dependency',
        });
      });
      if (node.logicRuleId && ids.has(node.logicRuleId)) {
        edges.push({
          from: node.logicRuleId,
          to: node.id,
          type: 'dependency',
        });
      }
    });


    const processedTwin = new Set<string>();

    nodes.forEach(node => {
      if (!node.twinGroup) return;

      if (
        processedTwin.has(node.twinGroup)
      ) {
        return;
      }

      processedTwin.add(node.twinGroup);

      const members = nodes.filter(
        n =>
          n.twinGroup === node.twinGroup
      );

      for (
        let i = 0;
        i < members.length;
        i++
      ) {
        const a = members[i];
        const b =
          members[
            (i + 1) % members.length
          ];

        if (!b) continue;

        edges.push({
          from: a.id,
          to: b.id,
          type: 'twin',
        });
      }
    });

    return edges;
  }


  /**
   * 检查一个节点是否可以加入知识网络
   * 后续接入 GitHub 数据库存储时使用
   */
  validateNode(
    node: KnowledgeSceneNode
  ): {
    valid: boolean;
    reasons: string[];
  } {

    const reasons: string[] = [];

    if (!node.id) {
      reasons.push(
        '节点缺少唯一ID'
      );
    }

    if (!node.title) {
      reasons.push(
        '节点缺少标题'
      );
    }

    if (
      !Array.isArray(node.premises)
    ) {
      reasons.push(
        '依赖关系格式错误'
      );
    }


    const ids = new Set(
      this.getNodes()
        .map(n => n.id)
    );

    node.premises.forEach(
      dependency => {
        if (!ids.has(dependency)) {
          reasons.push(
            `依赖节点不存在:${dependency}`
          );
        }
      }
    );


    return {
      valid:
        reasons.length === 0,
      reasons,
    };
  }


  /**
   * 检测循环依赖
   */
  detectCycle(
    nodeId: string
  ): boolean {

    const visiting = new Set<string>();

    const dfs = (
      id: string
    ): boolean => {

      if (
        visiting.has(id)
      ) {
        return true;
      }

      visiting.add(id);

      const node =
        this.getNodes()
          .find(n =>
            n.id === id
          );

      if (!node) {
        visiting.delete(id);
        return false;
      }


      for (
        const dep of node.premises
      ) {
        if (dfs(dep)) {
          return true;
        }
      }

      visiting.delete(id);

      return false;
    };


    return dfs(nodeId);
  }
}
