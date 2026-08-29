import type { GraphNode } from '../graph/Node';
import { currentNodeForTopic, topicIdFor } from './KnowledgeLineage';

/** Graph-generation-local facts shared while building the rendered projection. */
export interface KnowledgeGraphIndex {
  readonly byId: ReadonlyMap<string, GraphNode>;
  readonly currentByTopic: ReadonlyMap<string, GraphNode>;
}

export function createKnowledgeGraphIndex(nodes: readonly GraphNode[]): KnowledgeGraphIndex {
  const byId = new Map<string, GraphNode>();
  const byTopic = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    byId.set(node.id, node);
    const topicId = topicIdFor(node);
    const members = byTopic.get(topicId);
    if (members) members.push(node);
    else byTopic.set(topicId, [node]);
  }

  const currentByTopic = new Map<string, GraphNode>();
  for (const [topicId, members] of byTopic) {
    const current = currentNodeForTopic(members, topicId);
    if (current) currentByTopic.set(topicId, current);
  }
  return Object.freeze({ byId, currentByTopic });
}

export function effectivePremiseIds(node: GraphNode, index: KnowledgeGraphIndex): string[] {
  return [...new Set(node.premises.map(premiseId => {
    const premise = index.byId.get(premiseId);
    return premise ? index.currentByTopic.get(topicIdFor(premise))?.id ?? premiseId : premiseId;
  }))];
}
