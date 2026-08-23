import type { NodeStatus, NodeType } from '../event/Event';
import type { UserKnowledgeLayer } from './KnowledgeLayerPolicy';
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
  type?: NodeType;
  status?: NodeStatus;
  declaredLayer?: UserKnowledgeLayer;
  lineage?: KnowledgeLineageMeta;
}

export interface KnowledgeRelationItem {
  id: string;
  title: string;
  /**
   * These semantic fields let presentation use the same visual identity as the
   * real node ball without inventing a second relation lookup or colour table.
   * They do not change relation topology.
   */
  type?: NodeType;
  status?: NodeStatus;
  declaredLayer?: UserKnowledgeLayer;
  lineage?: KnowledgeLineageMeta;
}

/**
 * The four canonical directions around one opened knowledge ball.
 *
 * previous / next are graph-neighbour directions, not semantic labels such as
 * “premise” or “conclusion”. A conclusion can have a reasoning-process ball on
 * its left, and the same conclusion can have another reasoning-process ball on
 * its right when it becomes input to a later inference.
 *
 * history / opposition are the two lineage axes for the same topic. Every item
 * exposed here is a real one-hop node joined to the opened ball by a live scene
 * edge. White reasoning / relation balls therefore participate exactly like any
 * other knowledge node instead of becoming edge labels.
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

type KnowledgeRelationAxis = 'logical' | 'history' | 'opposition';
interface CanonicalKnowledgeEdge extends KnowledgeChainEdge {
  axis: KnowledgeRelationAxis;
}

function item(node: KnowledgeRelationNode): KnowledgeRelationItem {
  return {
    id: node.id,
    title: node.title,
    type: node.type,
    status: node.status,
    declaredLayer: node.declaredLayer,
    lineage: node.lineage,
  };
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

function appendCanonicalEdge(
  edges: CanonicalKnowledgeEdge[],
  seen: Set<string>,
  fromId: string,
  toId: string,
  axis: KnowledgeRelationAxis,
): void {
  if (!fromId || !toId || fromId === toId) return;
  // The scene owns one physical line for a node pair. If the same pair is ever
  // reachable through two semantic families, the first canonical family wins
  // rather than drawing or exposing duplicate relations.
  const key = `${fromId}->${toId}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ fromId, toId, axis });
}

/**
 * Internal authoritative edge projection shared by scene geometry and the
 * opened-node neighbour buttons. This prevents the detail UI from inventing a
 * relation that has no corresponding line, or omitting a real line endpoint.
 * logicRuleId is metadata on a white reasoning node, never another visual edge.
 */
function collectCanonicalKnowledgeEdges(
  nodes: readonly KnowledgeRelationNode[],
): CanonicalKnowledgeEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: CanonicalKnowledgeEdge[] = [];

  // Effective logical knowledge chain. Reasoning-process / relation balls are
  // ordinary first-class nodes in this chain.
  for (const node of nodes) {
    if (lineageRoleFor(node) !== 'current') continue;
    for (const previousId of node.premises) {
      const previous = effectiveNode(byId.get(previousId), nodes);
      if (!previous || lineageRoleFor(previous) !== 'current' || previous.id === node.id) continue;
      appendCanonicalEdge(edges, seen, previous.id, node.id, 'logical');
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
      appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
      previous = history;
    }

    previous = current;
    for (const opposition of stableLineageChain(nodes, topicId, 'opposition')) {
      appendCanonicalEdge(edges, seen, previous.id, opposition.id, 'opposition');
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
      appendCanonicalEdge(
        edges,
        seen,
        target.id,
        candidate.id,
        role === 'candidate-history' ? 'history' : 'opposition',
      );
    }
  }

  return edges;
}

/**
 * One authoritative one-hop relation projection for node detail.
 *
 * A button exists iff the opened node is an endpoint of the same canonical edge
 * used by the 3D scene. Logical edges keep their left/right direction; lineage
 * edges are navigable in either direction on their vertical axis. This makes
 * opening a neighbour equivalent to clicking the real connected ball.
 */
export function buildKnowledgeRelations(
  openedId: string,
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelations {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  if (!byId.has(openedId)) return { previous: [], next: [], history: [], opposition: [] };

  const previous: KnowledgeRelationNode[] = [];
  const next: KnowledgeRelationNode[] = [];
  const history: KnowledgeRelationNode[] = [];
  const opposition: KnowledgeRelationNode[] = [];

  for (const edge of collectCanonicalKnowledgeEdges(nodes)) {
    if (edge.fromId !== openedId && edge.toId !== openedId) continue;
    const otherId = edge.fromId === openedId ? edge.toId : edge.fromId;
    const other = byId.get(otherId);
    if (!other || lineageRoleFor(other) === 'rejected') continue;

    if (edge.axis === 'logical') {
      if (edge.toId === openedId) previous.push(other);
      else next.push(other);
    } else if (edge.axis === 'history') {
      history.push(other);
    } else {
      opposition.push(other);
    }
  }

  return {
    previous: uniqueItems(previous),
    next: uniqueItems(next),
    history: uniqueItems(history),
    opposition: uniqueItems(opposition),
  };
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
  return collectCanonicalKnowledgeEdges(nodes).map(({ fromId, toId }) => ({ fromId, toId }));
}
