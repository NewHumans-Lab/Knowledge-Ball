import type { NodeStatus, NodeType } from '../event/Event';
import type { KnowledgeLayer } from './KnowledgeLayerPolicy';
import {
  currentNodeForTopic,
  dominantNodeForTopic,
  lineageRoleFor,
  reasoningHeadForTopic,
  reasoningHistoryChain,
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
  declaredLayer?: KnowledgeLayer;
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
  declaredLayer?: KnowledgeLayer;
  lineage?: KnowledgeLineageMeta;
}

/**
 * The four canonical directions around one opened knowledge ball.
 * previous / next are graph-neighbour directions; history/opposition are
 * lineage axes. Reasoning-process balls are real nodes, never edge labels.
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

/** Resolve an immutable version reference to the topic's effective logical head. */
function effectiveNode(
  node: KnowledgeRelationNode | undefined,
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelationNode | undefined {
  if (!node) return undefined;
  return dominantNodeForTopic(nodes, topicIdFor(node)) ?? node;
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
  const key = `${fromId}->${toId}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ fromId, toId, axis });
}

/**
 * Internal authoritative edge projection shared by scene geometry and opened
 * detail navigation. For reasoning topics the white/red camp colors are stable,
 * while `reasoningDominant` alone decides which head occupies the logical chain.
 * logicRuleId is metadata on a reasoning node and never becomes a visual edge.
 */
function collectCanonicalKnowledgeEdges(
  nodes: readonly KnowledgeRelationNode[],
): CanonicalKnowledgeEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const seen = new Set<string>();
  const edges: CanonicalKnowledgeEdge[] = [];

  // Effective logical chain. A red reasoning head can therefore replace the
  // white head in premises/reasoning/conclusion lines without rewriting stored
  // premise IDs or recoloring either camp.
  for (const node of nodes) {
    const effective = effectiveNode(node, nodes);
    if (!effective || effective.id !== node.id || lineageRoleFor(node) === 'rejected') continue;
    for (const previousId of node.premises) {
      const previous = effectiveNode(byId.get(previousId), nodes);
      if (!previous || lineageRoleFor(previous) === 'rejected' || previous.id === node.id) continue;
      appendCanonicalEdge(edges, seen, previous.id, node.id, 'logical');
    }
  }

  const topicIds = [...new Set(
    nodes
      .filter(node => lineageRoleFor(node) !== 'rejected')
      .map(topicIdFor),
  )];

  for (const topicId of topicIds) {
    const normalHead = reasoningHeadForTopic(nodes, topicId, 'normal');
    const redHead = reasoningHeadForTopic(nodes, topicId, 'opposition');

    if (normalHead) {
      // Reasoning topics have two independent version tails:
      // white head -> gray white history...
      // red head   -> gray red history...
      // The two live heads are joined only by the opposition axis.
      let previous = normalHead;
      for (const history of reasoningHistoryChain(nodes, topicId, 'normal')) {
        appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
        previous = history;
      }

      if (redHead) {
        appendCanonicalEdge(edges, seen, normalHead.id, redHead.id, 'opposition');
        previous = redHead;
        for (const history of reasoningHistoryChain(nodes, topicId, 'opposition')) {
          appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
          previous = history;
        }
      }

      for (const candidate of nodes) {
        const role = lineageRoleFor(candidate);
        if (topicIdFor(candidate) !== topicId
          || (role !== 'candidate-history' && role !== 'candidate-opposition')) continue;
        const target = candidate.lineage?.targetId ? byId.get(candidate.lineage.targetId) : undefined;
        if (!target || lineageRoleFor(target) === 'rejected') continue;
        appendCanonicalEdge(
          edges,
          seen,
          target.id,
          candidate.id,
          role === 'candidate-history' ? 'history' : 'opposition',
        );
      }
      continue;
    }

    // Legacy/non-reasoning lineage keeps the original single-current model.
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

/** Scene and detail navigation consume the exact same canonical edges. */
export function collectKnowledgeChainEdges(
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeChainEdge[] {
  return collectCanonicalKnowledgeEdges(nodes).map(({ fromId, toId }) => ({ fromId, toId }));
}
