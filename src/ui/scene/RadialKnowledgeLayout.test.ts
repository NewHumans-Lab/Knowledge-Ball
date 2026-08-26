import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  RADIAL_LAYOUT_LINK_LENGTH,
  RADIAL_LAYOUT_NODE_RADIUS,
  RADIAL_LAYOUT_PLANE_EDGE_LENGTH,
  applyRadialKnowledgeLayout,
  compactTriangularPlaneOffsets,
  positionsOnTriangularPlane,
  type RadialKnowledgeLayoutNode,
} from './RadialKnowledgeLayout';

const EPSILON = 1e-6;
const near = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
const nearVector = (actual: THREE.Vector3, expected: THREE.Vector3, message: string) =>
  assert.ok(actual.distanceTo(expected) < EPSILON, `${message}: ${actual.toArray()} != ${expected.toArray()}`);
const mean = (points: THREE.Vector3[]) => points
  .reduce((sum, point) => sum.add(point), new THREE.Vector3())
  .multiplyScalar(1 / points.length);

assert.equal(RADIAL_LAYOUT_LINK_LENGTH, RADIAL_LAYOUT_NODE_RADIUS * 5, 'L must equal 5R');
assert.equal(RADIAL_LAYOUT_PLANE_EDGE_LENGTH, RADIAL_LAYOUT_LINK_LENGTH, 'plane edge must equal 5R');
assert.equal(RADIAL_LAYOUT_LINK_LENGTH, 36, 'R=7.2 therefore L=36');

const triangle = compactTriangularPlaneOffsets(3);
near(triangle[0]!.distanceTo(triangle[1]!), RADIAL_LAYOUT_LINK_LENGTH, 'triangle edge 01');
near(triangle[1]!.distanceTo(triangle[2]!), RADIAL_LAYOUT_LINK_LENGTH, 'triangle edge 12');
near(triangle[2]!.distanceTo(triangle[0]!), RADIAL_LAYOUT_LINK_LENGTH, 'triangle edge 20');

const seven = compactTriangularPlaneOffsets(7);
const centerPoint = seven.find(point => point.length() < EPSILON);
assert.ok(centerPoint, '7 nodes must contain one centre point');
const outer = seven.filter(point => point.length() >= EPSILON);
assert.equal(outer.length, 6, '7 nodes must be centre + six outer points');
for (const point of outer) near(point.length(), RADIAL_LAYOUT_LINK_LENGTH, 'hexagon radius');
for (let i = 0; i < seven.length; i += 1) {
  for (let j = i + 1; j < seven.length; j += 1) {
    assert.ok(seven[i]!.distanceTo(seven[j]!) + EPSILON >= RADIAL_LAYOUT_LINK_LENGTH, 'triangular packing must keep at least 5R spacing');
  }
}

const planeCenter = new THREE.Vector3(90, 0, 0);
const radial = new THREE.Vector3(1, 0, 0);
const plane = positionsOnTriangularPlane(planeCenter, radial, 7);
for (const point of plane) near(point.x, planeCenter.x, 'expanded points stay on one tangent plane');

const premiseFanIn: RadialKnowledgeLayoutNode[] = [
  { id: 'p1', type: 'definition', premises: [] },
  { id: 'p2', type: 'fact', premises: [] },
  { id: 'p3', type: 'axiom', premises: [] },
  { id: 'reasoning-1', type: 'reasoning', premises: ['p1', 'p2', 'p3'] },
  { id: 'c1', type: 'theory', premises: ['reasoning-1'] },
];
applyRadialKnowledgeLayout(premiseFanIn);
const p1 = premiseFanIn[0]!.pos!;
const p2 = premiseFanIn[1]!.pos!;
const p3 = premiseFanIn[2]!.pos!;
const reasoning1 = premiseFanIn[3]!.pos!;
const conclusion = premiseFanIn[4]!.pos!;
near(p1.x, p2.x, 'premises share one tangent plane');
near(p2.x, p3.x, 'premises share one tangent plane');
near(p1.distanceTo(p2), RADIAL_LAYOUT_LINK_LENGTH, 'premise triangle edge 12');
near(p2.distanceTo(p3), RADIAL_LAYOUT_LINK_LENGTH, 'premise triangle edge 23');
near(p3.distanceTo(p1), RADIAL_LAYOUT_LINK_LENGTH, 'premise triangle edge 31');
near(conclusion.x - p1.x, RADIAL_LAYOUT_LINK_LENGTH, 'next knowledge plane advances outward by 5R in radial projection');
assert.ok(conclusion.distanceTo(p1) > RADIAL_LAYOUT_LINK_LENGTH, 'lateral expansion may make cross-plane edge longer than 5R');
const premiseCenter = mean([p1, p2, p3]);
nearVector(reasoning1, premiseCenter.clone().add(conclusion).multiplyScalar(0.5), 'reasoning must be midpoint of premise-centre and conclusion-centre');

const conclusionFanOut: RadialKnowledgeLayoutNode[] = [
  { id: 'p', type: 'definition', premises: [] },
  { id: 'reasoning-2', type: 'reasoning', premises: ['p'] },
  { id: 'c-a', type: 'fact', premises: ['reasoning-2'] },
  { id: 'c-b', type: 'fact', premises: ['reasoning-2'] },
  { id: 'c-c', type: 'fact', premises: ['reasoning-2'] },
];
applyRadialKnowledgeLayout(conclusionFanOut);
const premise = conclusionFanOut[0]!.pos!;
const reasoning2 = conclusionFanOut[1]!.pos!;
const ca = conclusionFanOut[2]!.pos!;
const cb = conclusionFanOut[3]!.pos!;
const cc = conclusionFanOut[4]!.pos!;
near(ca.x, cb.x, 'conclusions share one tangent plane');
near(cb.x, cc.x, 'conclusions share one tangent plane');
near(ca.distanceTo(cb), RADIAL_LAYOUT_LINK_LENGTH, 'conclusion triangle edge ab');
near(cb.distanceTo(cc), RADIAL_LAYOUT_LINK_LENGTH, 'conclusion triangle edge bc');
near(cc.distanceTo(ca), RADIAL_LAYOUT_LINK_LENGTH, 'conclusion triangle edge ca');
const conclusionCenter = mean([ca, cb, cc]);
nearVector(reasoning2, premise.clone().add(conclusionCenter).multiplyScalar(0.5), 'fan-out reasoning must use equal-weight side centres');

console.log('Compressed triangular chain layout and reasoning-centre checks passed');
