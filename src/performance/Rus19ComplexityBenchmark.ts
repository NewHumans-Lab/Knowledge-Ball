import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { GraphNode } from '../graph/Node';
import { createKnowledgeGraphIndex, effectivePremiseIds } from '../domain/KnowledgeGraphIndex';
import { currentNodeForTopic, topicIdFor } from '../domain/KnowledgeLineage';
import { bindReasoningConclusions } from '../domain/ReasoningConclusion';
import type { ProtocolNode } from '../protocol/KnowledgeEditingProtocol';
import { generateIcosahedralGrid, nearbyCandidateCells, type LayoutNode } from '../ui/scene/Deterministic5RLayout';
import { applyUniformLayerLayout } from '../ui/scene/UniformLayerLayout';

const elapsed = (operation: () => void, iterations = 1) => {
  const start = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) operation();
  return performance.now() - start;
};

const graphNodes: GraphNode[] = Array.from({ length: 2_000 }, (_, index) => ({
  id: `node-${index}`,
  title: `Node ${index}`,
  type: 'fact',
  status: 'verified',
  mastery: 'none',
  reasoning: `Reason ${index}`,
  premises: index ? [`node-${index - 1}`] : [],
  lineage: { topicId: `topic-${index}`, proposal: 'new', role: 'current', rank: 0 },
}));

const legacyPremises = () => graphNodes.map(node => {
  const byId = new Map(graphNodes.map(item => [item.id, item] as const));
  return [...new Set(node.premises.map(premiseId => {
    const premise = byId.get(premiseId);
    return premise ? currentNodeForTopic(graphNodes, topicIdFor(premise))?.id ?? premiseId : premiseId;
  }))];
});
const indexedPremises = () => {
  const index = createKnowledgeGraphIndex(graphNodes);
  return graphNodes.map(node => effectivePremiseIds(node, index));
};
assert.deepEqual(indexedPremises(), legacyPremises());

const reasoningNodes = Array.from({ length: 1_000 }, (_, index) => ({
  id: `reasoning-${index}`,
  type: 'reasoning',
  status: 'verified' as const,
  premises: [] as string[],
})).flatMap((reasoning, index) => [reasoning, {
  id: `conclusion-${index}`,
  type: 'fact',
  status: 'verified' as const,
  premises: [reasoning.id],
}]);

const grid = generateIcosahedralGrid(360);
const target = new THREE.Vector3(20, 300, -80);
const legacyNearest = () => grid.vertices.map((vertex, index) => ({ index, distance: vertex.distanceToSquared(target) }))
  .sort((left, right) => left.distance - right.distance || left.index - right.index).slice(0, 7).map(value => value.index);
assert.deepEqual(nearbyCandidateCells(grid, target, 7), legacyNearest());

const dagNodes: ProtocolNode[] = Array.from({ length: 1_000 }, (_, index) => ({
  id: `dag-${index}`, title: `DAG ${index}`, type: 'fact', reasoning: `DAG ${index}`,
  premises: index ? [`dag-${index - 1}`] : [], status: 'verified',
}));
const dagQueries = Array.from({ length: 25 }, (_, index) => [`dag-${index}`, 'dag-999'] as const);
const downstream = () => {
  const result = new Map<string, string[]>();
  for (const node of dagNodes) for (const premiseId of node.premises) {
    const children = result.get(premiseId) ?? [];
    children.push(node.id);
    result.set(premiseId, children);
  }
  return result;
};
const reaches = (index: ReadonlyMap<string, readonly string[]>, fromId: string, targetId: string) => {
  const seen = new Set([fromId]), queue = [fromId];
  while (queue.length) for (const child of index.get(queue.shift()!) ?? []) {
    if (child === targetId) return true;
    if (!seen.has(child)) { seen.add(child); queue.push(child); }
  }
  return fromId === targetId;
};
const legacyDagResults = () => dagQueries.map(([fromId, targetId]) => reaches(downstream(), fromId, targetId));
const indexedDagResults = () => {
  const index = downstream();
  return dagQueries.map(([fromId, targetId]) => reaches(index, fromId, targetId));
};
assert.deepEqual(indexedDagResults(), legacyDagResults());

let layoutGeneration = 0;
const layoutFixture = () => {
  const prefix = `layout-${layoutGeneration++}`;
  const nodes: LayoutNode[] = [
    { id: `${prefix}-a`, type: 'fact', premises: [], declaredLayer: 'inner' },
    { id: `${prefix}-r`, type: 'reasoning', premises: [`${prefix}-a`], declaredLayer: 'inner' },
    { id: `${prefix}-b`, type: 'fact', premises: [`${prefix}-r`], declaredLayer: 'inner', lineage: { topicId: `${prefix}-topic`, proposal: 'new', role: 'current', rank: 0 } },
    { id: `${prefix}-history`, type: 'fact', premises: [], declaredLayer: 'inner', lineage: { topicId: `${prefix}-topic`, proposal: 'optimization', targetId: `${prefix}-b`, role: 'history', rank: 1 } },
    { id: `${prefix}-opposition`, type: 'fact', premises: [], declaredLayer: 'inner', lineage: { topicId: `${prefix}-topic`, proposal: 'opposition', targetId: `${prefix}-b`, role: 'opposition', rank: 1 } },
  ];
  applyUniformLayerLayout(nodes);
};

const results = {
  projectionLegacyMs: elapsed(legacyPremises),
  projectionIndexedMs: elapsed(indexedPremises),
  reasoningIndexedMs: elapsed(() => bindReasoningConclusions(structuredClone(reasoningNodes)), 5) / 5,
  dagRepeatedIndexMs: elapsed(legacyDagResults, 10) / 10,
  dagSharedIndexMs: elapsed(indexedDagResults, 10) / 10,
  nearestFullSortMs: elapsed(legacyNearest, 100) / 100,
  nearestTopKMs: elapsed(() => nearbyCandidateCells(grid, target, 7), 100) / 100,
  nearestCellCount: grid.vertices.length,
  fixedLineageLayoutMs: elapsed(layoutFixture, 20) / 20,
};
console.log(JSON.stringify(results, null, 2));
