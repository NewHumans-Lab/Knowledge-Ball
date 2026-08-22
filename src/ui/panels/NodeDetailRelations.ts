import {
  currentNodeForTopic,
  lineageRoleFor,
  stableLineageChain,
  topicIdFor,
} from '../../domain/KnowledgeLineage';
import type { GraphNode } from '../../graph/Node';

export interface NodeDetailRelationItem {
  id: string;
  title: string;
}

export interface NodeDetailRelations {
  premises: NodeDetailRelationItem[];
  conclusions: NodeDetailRelationItem[];
  history: NodeDetailRelationItem[];
  opposition: NodeDetailRelationItem[];
}

function item(node: Pick<GraphNode, 'id' | 'title'>): NodeDetailRelationItem {
  return { id: node.id, title: node.title };
}

function effectivePremise(node: GraphNode | undefined, nodes: readonly GraphNode[]): GraphNode | undefined {
  if (!node) return undefined;
  return currentNodeForTopic(nodes, topicIdFor(node)) ?? node;
}

function uniqueItems(nodes: readonly GraphNode[]): NodeDetailRelationItem[] {
  const seen = new Set<string>();
  const result: NodeDetailRelationItem[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(item(node));
  }
  return result;
}

/**
 * Detail relations are deliberately shallow:
 * left/right are distance=1 logical neighbors only; top/bottom are the two
 * linear lineage chains for the opened topic. No transitive graph expansion is
 * performed here.
 */
export function buildNodeDetailRelations(
  openedId: string,
  nodes: readonly GraphNode[],
): NodeDetailRelations {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const opened = byId.get(openedId);
  if (!opened) return { premises: [], conclusions: [], history: [], opposition: [] };

  const premiseNodes = opened.premises
    .map(id => effectivePremise(byId.get(id), nodes))
    .filter((node): node is GraphNode => Boolean(node && lineageRoleFor(node) !== 'rejected'));

  // A current dependent may still store the immutable historical premise ID in
  // its ball payload. Resolve that premise's topic to its effective current for
  // display, without rewriting the dependent ball itself.
  const conclusionNodes = nodes.filter(candidate => {
    if (candidate.id === opened.id || lineageRoleFor(candidate) !== 'current') return false;
    return candidate.premises.some(premiseId => {
      const effective = effectivePremise(byId.get(premiseId), nodes);
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
    premises: uniqueItems(premiseNodes),
    conclusions: uniqueItems(conclusionNodes),
    history,
    opposition,
  };
}
