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

export interface KnowledgeRelationIndex {
  /** Stable canonical scene edges for one graph topology generation. */
  readonly edges: readonly KnowledgeChainEdge[];
  /** O(1) adjacency lookup after the topology index has been built. */
  relationsFor(openedId: string): KnowledgeRelations;
}

type KnowledgeRelationAxis = 'logical' | 'history' | 'opposition';
interface CanonicalKnowledgeEdge extends KnowledgeChainEdge {
  axis: KnowledgeRelationAxis;
}

interface RelationBuckets {
  previous: KnowledgeRelationNode[];
  next: KnowledgeRelationNode[];
  history: KnowledgeRelationNode[];
  opposition: KnowledgeRelationNode[];
}

function emptyRelations(): KnowledgeRelations {
  return { previous: [], next: [], history: [], opposition: [] };
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
 * Build canonical relation topology once for one graph generation.
 * logicRuleId is metadata on a reasoning node and never becomes a visual edge.
 *
 * The previous implementation repeatedly searched the complete node array for
 * every node/topic. This groups nodes by topic first and resolves each topic's
 * dominant head once, reducing topology construction to roughly O(N + E) plus
 * the small per-topic rank sorts needed by immutable history chains.
 */
function collectCanonicalKnowledgeEdges(
  nodes: readonly KnowledgeRelationNode[],
): CanonicalKnowledgeEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const membersByTopic = new Map<string, KnowledgeRelationNode[]>();
  const seen = new Set<string>();
  const edges: CanonicalKnowledgeEdge[] = [];

  for (const node of nodes) {
    const topicId = topicIdFor(node);
    const members = membersByTopic.get(topicId);
    if (members) members.push(node);
    else membersByTopic.set(topicId, [node]);
  }

  const activeTopicIds: string[] = [];
  const dominantByTopic = new Map<string, KnowledgeRelationNode>();
  for (const [topicId, members] of membersByTopic) {
    if (!members.some(node => lineageRoleFor(node) !== 'rejected')) continue;
    activeTopicIds.push(topicId);
    const dominant = dominantNodeForTopic(members, topicId);
    if (dominant) dominantByTopic.set(topicId, dominant);
  }

  const effectiveNode = (node: KnowledgeRelationNode | undefined): KnowledgeRelationNode | undefined => {
    if (!node) return undefined;
    return dominantByTopic.get(topicIdFor(node)) ?? node;
  };

  // Effective logical chain. A red reasoning head can therefore replace the
  // white head in premises/reasoning/conclusion lines without rewriting stored
  // premise IDs or recoloring either camp.
  for (const node of nodes) {
    const effective = effectiveNode(node);
    if (!effective || effective.id !== node.id || lineageRoleFor(node) === 'rejected') continue;
    for (const previousId of node.premises) {
      const previous = effectiveNode(byId.get(previousId));
      if (!previous || lineageRoleFor(previous) === 'rejected' || previous.id === node.id) continue;
      appendCanonicalEdge(edges, seen, previous.id, node.id, 'logical');
    }
  }

  for (const topicId of activeTopicIds) {
    const members = membersByTopic.get(topicId)!;
    const normalHead = reasoningHeadForTopic(members, topicId, 'normal');
    const redHead = reasoningHeadForTopic(members, topicId, 'opposition');

    if (normalHead) {
      let previous = normalHead;
      for (const history of reasoningHistoryChain(members, topicId, 'normal')) {
        appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
        previous = history;
      }

      if (redHead) {
        appendCanonicalEdge(edges, seen, normalHead.id, redHead.id, 'opposition');
        previous = redHead;
        for (const history of reasoningHistoryChain(members, topicId, 'opposition')) {
          appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
          previous = history;
        }
      }

      for (const candidate of members) {
        const role = lineageRoleFor(candidate);
        if (role !== 'candidate-history' && role !== 'candidate-opposition') continue;
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
    const current = currentNodeForTopic(members, topicId);
    if (!current) continue;

    let previous = current;
    for (const history of stableLineageChain(members, topicId, 'history')) {
      appendCanonicalEdge(edges, seen, previous.id, history.id, 'history');
      previous = history;
    }

    previous = current;
    for (const opposition of stableLineageChain(members, topicId, 'opposition')) {
      appendCanonicalEdge(edges, seen, previous.id, opposition.id, 'opposition');
      previous = opposition;
    }

    for (const candidate of members) {
      const role = lineageRoleFor(candidate);
      if (role !== 'candidate-history' && role !== 'candidate-opposition') continue;
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

export function createKnowledgeRelationIndex(
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelationIndex {
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const canonicalEdges = collectCanonicalKnowledgeEdges(nodes);
  const bucketsById = new Map<string, RelationBuckets>();

  const buckets = (id: string): RelationBuckets => {
    const current = bucketsById.get(id);
    if (current) return current;
    const created: RelationBuckets = { previous: [], next: [], history: [], opposition: [] };
    bucketsById.set(id, created);
    return created;
  };

  for (const edge of canonicalEdges) {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (!from || !to || lineageRoleFor(from) === 'rejected' || lineageRoleFor(to) === 'rejected') continue;
    if (edge.axis === 'logical') {
      buckets(from.id).next.push(to);
      buckets(to.id).previous.push(from);
    } else if (edge.axis === 'history') {
      buckets(from.id).history.push(to);
      buckets(to.id).history.push(from);
    } else {
      buckets(from.id).opposition.push(to);
      buckets(to.id).opposition.push(from);
    }
  }

  const edges: readonly KnowledgeChainEdge[] = canonicalEdges.map(({ fromId, toId }) => ({ fromId, toId }));
  return {
    edges,
    relationsFor(openedId: string): KnowledgeRelations {
      if (!byId.has(openedId)) return emptyRelations();
      const relationBuckets = bucketsById.get(openedId);
      if (!relationBuckets) return emptyRelations();
      return {
        previous: uniqueItems(relationBuckets.previous),
        next: uniqueItems(relationBuckets.next),
        history: uniqueItems(relationBuckets.history),
        opposition: uniqueItems(relationBuckets.opposition),
      };
    },
  };
}

/** Compatibility helper for callers that do not retain a graph-generation index. */
export function buildKnowledgeRelations(
  openedId: string,
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeRelations {
  return createKnowledgeRelationIndex(nodes).relationsFor(openedId);
}

/** Compatibility helper for callers that do not retain a graph-generation index. */
export function collectKnowledgeChainEdges(
  nodes: readonly KnowledgeRelationNode[],
): KnowledgeChainEdge[] {
  return [...createKnowledgeRelationIndex(nodes).edges];
}
