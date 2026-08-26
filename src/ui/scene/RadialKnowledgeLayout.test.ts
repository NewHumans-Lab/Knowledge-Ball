import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  RADIAL_LAYOUT_LINK_LENGTH,
  RADIAL_LAYOUT_NODE_RADIUS,
  RADIAL_LAYOUT_PLANE_EDGE_LENGTH,
  type RadialKnowledgeLayoutNode,
} from './RadialKnowledgeLayout';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import {
  compactRelationGroupAxialCoordinates,
  compareRelationPackingPriority,
} from './TriangularRelationGroupPacking';

const EPSILON = 1e-6;
const near = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
const nearVector = (actual: THREE.Vector3, expected: THREE.Vector3, message: string) =>
  assert.ok(actual.distanceTo(expected) < EPSILON, `${message}: ${actual.toArray()} != ${expected.toArray()}`);
const mean = (points: THREE.Vector3[]) => points
  .reduce((sum, point) => sum.add(point), new THREE.Vector3())
  .multiplyScalar(1 / points.length);
const byId = (nodes: RadialKnowledgeLayoutNode[], id: string) => nodes.find(node => node.id === id)!;
const isNear = (a: THREE.Vector3, b: THREE.Vector3, distance: number) => Math.abs(a.distanceTo(b) - distance) < EPSILON;

function axialPlane([q, r]: [number, number]): THREE.Vector2 {
  return new THREE.Vector2(
    RADIAL_LAYOUT_LINK_LENGTH * (q + r / 2),
    RADIAL_LAYOUT_LINK_LENGTH * (Math.sqrt(3) / 2) * r,
  );
}

function assertEquilateral(nodes: RadialKnowledgeLayoutNode[], ids: string[], label: string): void {
  assert.equal(ids.length, 3);
  const points = ids.map(id => byId(nodes, id).pos!);
  near(points[0]!.distanceTo(points[1]!), RADIAL_LAYOUT_LINK_LENGTH, `${label} edge 01`);
  near(points[1]!.distanceTo(points[2]!), RADIAL_LAYOUT_LINK_LENGTH, `${label} edge 12`);
  near(points[2]!.distanceTo(points[0]!), RADIAL_LAYOUT_LINK_LENGTH, `${label} edge 20`);
}

function countEquilateralTriples(nodes: RadialKnowledgeLayoutNode[], triples: string[][]): number {
  return triples.filter(ids => {
    const [a, b, c] = ids.map(id => byId(nodes, id).pos!);
    return isNear(a!, b!, RADIAL_LAYOUT_LINK_LENGTH)
      && isNear(b!, c!, RADIAL_LAYOUT_LINK_LENGTH)
      && isNear(c!, a!, RADIAL_LAYOUT_LINK_LENGTH);
  }).length;
}

function assertSamePlaneMinimumSpacing(nodes: RadialKnowledgeLayoutNode[], ids: string[], label: string): void {
  const points = ids.map(id => byId(nodes, id).pos!);
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      assert.ok(
        points[i]!.distanceTo(points[j]!) + EPSILON >= RADIAL_LAYOUT_LINK_LENGTH,
        `${label}: ${ids[i]} and ${ids[j]} must stay at least 5R apart`,
      );
    }
  }
}

assert.equal(RADIAL_LAYOUT_LINK_LENGTH, RADIAL_LAYOUT_NODE_RADIUS * 5, 'L must equal 5R');
assert.equal(RADIAL_LAYOUT_PLANE_EDGE_LENGTH, RADIAL_LAYOUT_LINK_LENGTH, 'plane edge must equal 5R');
assert.equal(RADIAL_LAYOUT_LINK_LENGTH, 36, 'R=7.2 therefore L=36');

const compact3 = compactRelationGroupAxialCoordinates(3).map(axialPlane);
near(compact3[0]!.distanceTo(compact3[1]!), RADIAL_LAYOUT_LINK_LENGTH, '3-point template edge 01');
near(compact3[1]!.distanceTo(compact3[2]!), RADIAL_LAYOUT_LINK_LENGTH, '3-point template edge 12');
near(compact3[2]!.distanceTo(compact3[0]!), RADIAL_LAYOUT_LINK_LENGTH, '3-point template edge 20');

const compact4 = compactRelationGroupAxialCoordinates(4).map(axialPlane);
let compact4Edges = 0;
for (let i = 0; i < compact4.length; i += 1) {
  for (let j = i + 1; j < compact4.length; j += 1) {
    if (Math.abs(compact4[i]!.distanceTo(compact4[j]!) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON) compact4Edges += 1;
  }
}
assert.equal(compact4Edges, 5, '4 points must be two edge-sharing equilateral triangles, not a row');

const compact7 = compactRelationGroupAxialCoordinates(7).map(axialPlane);
const centerIndex = compact7.findIndex((point, index) =>
  compact7.filter((_, otherIndex) => otherIndex !== index)
    .every(other => Math.abs(point.distanceTo(other) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON),
);
assert.ok(centerIndex >= 0, '7-point template must contain one centre with six 5R neighbours');
for (let i = 0; i < compact7.length; i += 1) {
  for (let j = i + 1; j < compact7.length; j += 1) {
    assert.ok(compact7[i]!.distanceTo(compact7[j]!) + EPSILON >= RADIAL_LAYOUT_LINK_LENGTH, 'compact template may never go below 5R');
  }
}

assert.ok(compareRelationPackingPriority([3, 3], [7]) < 0, 'satisfying two groups must beat satisfying only one larger group');
assert.ok(compareRelationPackingPriority([7, 3], [6, 4]) < 0, 'when group count ties, the larger satisfied group must win first');
assert.equal(compareRelationPackingPriority([7, 3], [7, 3]), 0, 'identical satisfied-group sizes must tie');

const premiseFanIn: RadialKnowledgeLayoutNode[] = [
  { id: 'p1', type: 'definition', premises: [] },
  { id: 'p2', type: 'fact', premises: [] },
  { id: 'p3', type: 'axiom', premises: [] },
  { id: 'reasoning-1', type: 'reasoning', premises: ['p1', 'p2', 'p3'] },
  { id: 'c1', type: 'theory', premises: ['reasoning-1'] },
];
applyUniformLayerLayout(premiseFanIn);
assertEquilateral(premiseFanIn, ['p1', 'p2', 'p3'], 'same-conclusion premise group');
const p1 = byId(premiseFanIn, 'p1').pos!;
const p2 = byId(premiseFanIn, 'p2').pos!;
const p3 = byId(premiseFanIn, 'p3').pos!;
const conclusion = byId(premiseFanIn, 'c1').pos!;
near(p1.x, p2.x, 'premises stay on one radial plane');
near(p2.x, p3.x, 'premises stay on one radial plane');
near(conclusion.x - p1.x, RADIAL_LAYOUT_LINK_LENGTH, 'next knowledge plane still advances outward by 5R');
const premiseCenter = mean([p1, p2, p3]);
const lateralCenterError = new THREE.Vector2(premiseCenter.y - conclusion.y, premiseCenter.z - conclusion.z).length();
assert.ok(lateralCenterError <= RADIAL_LAYOUT_LINK_LENGTH + EPSILON, 'premise group centre must stay as close as lattice quantization allows to conclusion projection');
nearVector(
  byId(premiseFanIn, 'reasoning-1').pos!,
  premiseCenter.clone().add(conclusion).multiplyScalar(0.5),
  'reasoning must remain midpoint of premise and conclusion centres after packing',
);

const conclusionFanOut: RadialKnowledgeLayoutNode[] = [
  { id: 'p', type: 'definition', premises: [] },
  { id: 'r-a', type: 'reasoning', premises: ['p'] },
  { id: 'ca', type: 'fact', premises: ['r-a'] },
  { id: 'r-b', type: 'reasoning', premises: ['p'] },
  { id: 'cb', type: 'fact', premises: ['r-b'] },
  { id: 'r-c', type: 'reasoning', premises: ['p'] },
  { id: 'cc', type: 'fact', premises: ['r-c'] },
];
applyUniformLayerLayout(conclusionFanOut);
assertEquilateral(conclusionFanOut, ['ca', 'cb', 'cc'], 'same-premise conclusion group');
assertSamePlaneMinimumSpacing(conclusionFanOut, ['ca', 'cb', 'cc'], 'fan-out layer');

const sharedBranch: RadialKnowledgeLayoutNode[] = [
  { id: 'a', type: 'definition', premises: [] },
  { id: 'b', type: 'definition', premises: [] },
  { id: 'c', type: 'definition', premises: [] },
  { id: 'd', type: 'definition', premises: [] },
  { id: 'r-left', type: 'reasoning', premises: ['a', 'b', 'c'] },
  { id: 'left', type: 'theory', premises: ['r-left'] },
  { id: 'r-right', type: 'reasoning', premises: ['b', 'c', 'd'] },
  { id: 'right', type: 'theory', premises: ['r-right'] },
];
applyUniformLayerLayout(sharedBranch);
assertEquilateral(sharedBranch, ['a', 'b', 'c'], 'first shared premise group');
assertEquilateral(sharedBranch, ['b', 'c', 'd'], 'second shared premise group');
assertSamePlaneMinimumSpacing(sharedBranch, ['a', 'b', 'c', 'd'], 'shared-branch root layer');

const sevenPremises: RadialKnowledgeLayoutNode[] = [
  ...Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, type: 'fact', premises: [] })),
  { id: 'r-seven', type: 'reasoning', premises: Array.from({ length: 7 }, (_, index) => `s${index}`) },
  { id: 'seven-out', type: 'theory', premises: ['r-seven'] },
];
applyUniformLayerLayout(sevenPremises);
const sevenPoints = Array.from({ length: 7 }, (_, index) => byId(sevenPremises, `s${index}`).pos!);
const sevenCenterIndex = sevenPoints.findIndex((point, index) =>
  sevenPoints.filter((_, otherIndex) => otherIndex !== index)
    .every(other => Math.abs(point.distanceTo(other) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON),
);
assert.ok(sevenCenterIndex >= 0, '7 related premises must realize centre + regular six-neighbour ring when there is no conflict');
assertSamePlaneMinimumSpacing(sevenPremises, Array.from({ length: 7 }, (_, index) => `s${index}`), 'seven-premise layer');

const impossibleK4: RadialKnowledgeLayoutNode[] = [
  { id: 'ka', type: 'definition', premises: [] },
  { id: 'kb', type: 'definition', premises: [] },
  { id: 'kc', type: 'definition', premises: [] },
  { id: 'kd', type: 'definition', premises: [] },
  { id: 'kr1', type: 'reasoning', premises: ['ka', 'kb', 'kc'] },
  { id: 'ko1', type: 'theory', premises: ['kr1'] },
  { id: 'kr2', type: 'reasoning', premises: ['ka', 'kb', 'kd'] },
  { id: 'ko2', type: 'theory', premises: ['kr2'] },
  { id: 'kr3', type: 'reasoning', premises: ['ka', 'kc', 'kd'] },
  { id: 'ko3', type: 'theory', premises: ['kr3'] },
  { id: 'kr4', type: 'reasoning', premises: ['kb', 'kc', 'kd'] },
  { id: 'ko4', type: 'theory', premises: ['kr4'] },
];
applyUniformLayerLayout(impossibleK4);
const k4Triples = [
  ['ka', 'kb', 'kc'],
  ['ka', 'kb', 'kd'],
  ['ka', 'kc', 'kd'],
  ['kb', 'kc', 'kd'],
];
assert.equal(countEquilateralTriples(impossibleK4, k4Triples), 2, 'when four triangle constraints cannot coexist, packing must realize the maximum two');
assertSamePlaneMinimumSpacing(impossibleK4, ['ka', 'kb', 'kc', 'kd'], 'conflicting root layer');

console.log('Compressed radial chain plus triangular relation-group maximum-satisfaction checks passed');
