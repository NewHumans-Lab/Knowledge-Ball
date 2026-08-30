import type { GraphNode } from '../graph/Node';
import { currentNodeForTopic, dominantNodeForTopic, topicIdFor } from './KnowledgeLineage';

/** Graph-generation-local facts shared while building the rendered projection. */
export interface KnowledgeGraphIndex {
  readonly byId: ReadonlyMap<string, GraphNode>;
  readonly byTopic: ReadonlyMap<string, readonly GraphNode[]>;
  /** Canonical white/ordinary Current identity for UI/lineage semantics. */
  readonly currentByTopic: ReadonlyMap<string, GraphNode>;
  /** Logical-chain authority: the winning reasoning-side head, or Current for ordinary topics. */
  readonly dominantByTopic: ReadonlyMap<string, GraphNode>;
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
  const dominantByTopic = new Map<string, GraphNode>();
  for (const [topicId, members] of byTopic) {
    const current = currentNodeForTopic(members, topicId);
    if (current) currentByTopic.set(topicId, current);
    const dominant = dominantNodeForTopic(members, topicId);
    if (dominant) dominantByTopic.set(topicId, dominant);
  }
  return Object.freeze({ byId, byTopic, currentByTopic, dominantByTopic });
}

export function effectivePremiseIds(node: GraphNode, index: KnowledgeGraphIndex): string[] {
  return [...new Set(node.premises.map(premiseId => {
    const premise = index.byId.get(premiseId);
    return premise ? index.dominantByTopic.get(topicIdFor(premise))?.id ?? premiseId : premiseId;
  }))];
}
