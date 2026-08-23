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
 * Horizontal knowledge-chain truth comes from real node-to-node premise
 * references. Reasoning-process balls are ordinary nodes in that chain:
 *
 *   premise -> reasoning process -> conclusion -> next reasoning process -> ...
 *
 * The same domain model also owns the vertical history/opposition axes. Those
 * lineage relations are real graph relations, not logical premises.
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

function appendEdge(
  edges: KnowledgeChainEdge[],
  seen: Set<string>,
  fromId: string,
  toId: string,
): void {
  if (!fromId || !toId || fromId === toId) return;
  const key = `${fromId}->${toId}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ fromId, toId });
}

/**
 * Canonical scene edges contain two relation families while sharing one visual
 * lifecycle in KnowledgeScene:
 *
 * 1. the effective CURRENT logical chain (premise/reasoning/conclusion), and
 * 2. the two lineage axes for each topic.
 *
 * Stable lineage edges are chains rather than stars so rank has geometric
 * meaning:
 *
 *   current -> history#1 -> history#2 -> ...
 *   current -> opposition#1 -> opposition#2 -> ...
 *
 * Pending optimization/opposition candidates connect to the target ball they
 * were proposed against. Rejected audit-only records never receive live edges.
 * Visibility is deliberately not decided here; KnowledgeScene applies the same
 * endpoint visibility rule to logical and lineage edges, so a line appears and
 * disappears with its balls.
 */
export function collectKnowledgeChainEdges(
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeChainEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: KnowledgeChainEdge[] = [];

  // Effective logical knowledge chain.
  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'current') continue;
    for (const previousId of node.premises) {
      const previous = effectiveNode(byId.get(previousId), nodes);
      if (!previous || lineageRoleFor(previous) !== 'current' || previous.id === node.id) continue;
      appendEdge(edges, seen, previous.id, node.id);
    }
  }

  // Formal version/opposition axes.
  const topicIds = [...new Set(
    nodes
      .filter(node => lineageRoleFor(node) !== 'rejected')
      .map(topicIdFor),
  )];

  for (const topicId of topicIds) {
    const current = currentNodeForTopic(nodes, topicId);
    if (!current) continue;

    let previous = current;
    for (const history of stableLineageChain(nodes, topicId, 'history')) {
      appendEdge(edges, seen, previous.id, history.id);
      previous = history;
    }

    previous = current;
    for (const opposition of stableLineageChain(nodes, topicId, 'opposition')) {
      appendEdge(edges, seen, previous.id, opposition.id);
      previous = opposition;
    }

    for (const candidate of nodes) {
      const role = lineageRoleFor(candidate);
      if (topicIdFor(candidate) !== topicId
        || (role !== 'candidate-history' && role !== 'candidate-opposition')) continue;
      const target = candidate.lineage?.targetId
        ? byId.get(candidate.lineage.targetId)
        : current;
      if (!target || lineageRoleFor(target) === 'rejected') continue;
      appendEdge(edges, seen, target.id, candidate.id);
    }
  }

  return edges;
}
