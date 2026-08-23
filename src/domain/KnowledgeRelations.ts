import {
  currentNodeForTopic,
  lineageRoleFor,
  stableLineageChain,
  topicIdFor,
  type KnowledgeLineageMeta,
} from './KnowledgeLineage';

export interface KnowledgeRelationNode {
  id: string;
  title: string;
  premises: readonly string[];
  lineage?: KnowledgeLineageMeta;
}

export interface KnowledgeRelationItem {
  id: string;
  title: string;
}

/**
 * The four canonical directions around one opened knowledge ball.
 *
 * previous / next are graph-neighbour directions, not semantic labels such as
 * “premise” or “conclusion”. A conclusion can have a reasoning-process ball on
 * its left, and the same conclusion can have another reasoning-process ball on
 * its right when it becomes input to a later inference.
 *
 * history / opposition are the two stable lineage chains for the same topic.
 */
export interface KnowledgeRelations {
  previous: KnowledgeRelationItem[];
  next: KnowledgeRelationItem[];
  history: KnowledgeRelationItem[];
  opposition: KnowledgeRelationItem[];
}

export interface KnowledgeChainEdge {
  fromId: string;
  toId: string;
}

function item(node: Pick<KnowledgeRelationNode, 'id' | 'title'>): KnowledgeRelationItem {
  return { id: node.id, title: node.title };
}

function effectiveNode(
  node: KnowledgeRelationNode | undefined,
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelationNode | undefined {
  if (!node) return undefined;
  return currentNodeForTopic(nodes, topicIdFor(node)) ?? node;
}

function uniqueItems(nodes: readonly KnowledgeRelationNode[]): KnowledgeRelationItem[] {
  const seen = new Set<string>();
  const result: KnowledgeRelationItem[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(item(node));
  }
  return result;
}

/**
 * One authoritative relation projection for scene lines and node detail.
 *
 * Horizontal knowledge-chain truth comes only from real node-to-node premise
 * references. Reasoning-process balls are ordinary nodes in that chain:
 *
 *   premise -> reasoning process -> conclusion -> next reasoning process -> ...
 *
 * logicRuleId is metadata on a reasoning node, not a second visual edge type.
 * Legacy twin UI metadata is intentionally absent from this model.
 */
export function buildKnowledgeRelations(
  openedId: string,
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelations {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const opened = byId.get(openedId);
  if (!opened) return { previous: [], next: [], history: [], opposition: [] };

  const previousNodes = opened.premises
    .map(id => effectiveNode(byId.get(id), nodes))
    .filter((node): node is KnowledgeRelationNode => Boolean(node && lineageRoleFor(node) !== 'rejected'));

  const nextNodes = nodes.filter(candidate => {
    if (candidate.id === opened.id || lineageRoleFor(candidate) !== 'current') return false;
    return candidate.premises.some(previousId => {
      const effective = effectiveNode(byId.get(previousId), nodes);
      return effective?.id === opened.id;
    });
  });

  const topicId = topicIdFor(opened);
  const history = stableLineageChain(nodes, topicId, 'history')
    .filter(node => node.id !== opened.id)
    .map(item);
  const opposition = stableLineageChain(nodes, topicId, 'opposition')
    .filter(node => node.id !== opened.id)
    .map(item);

  return {
    previous: uniqueItems(previousNodes),
    next: uniqueItems(nextNodes),
    history,
    opposition,
  };
}

/**
 * Scene/layout horizontal lines are the exact same immediate chain relation used
 * by node detail. Only effective CURRENT nodes participate in the live chain;
 * historical/opposing versions are represented by the vertical lineage axes.
 */
export function collectKnowledgeChainEdges(
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeChainEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: KnowledgeChainEdge[] = [];

  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'current') continue;
    for (const previousId of node.premises) {
      const previous = effectiveNode(byId.get(previousId), nodes);
      if (!previous || lineageRoleFor(previous) !== 'current' || previous.id === node.id) continue;
      const key = `${previous.id}->${node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ fromId: previous.id, toId: node.id });
    }
  }

  return edges;
}
