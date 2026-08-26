import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  RADIAL_LAYOUT_LINK_LENGTH,
  RADIAL_LAYOUT_MIN_PLANE_SPACING,
  RADIAL_LAYOUT_NODE_RADIUS,
  positionsOnPerpendicularPlane,
} from './RadialKnowledgeLayout';

// This test is intentionally limited to the new radial geometry contract.
const EPSILON = 1e-6;
const center = new THREE.Vector3(20, 0, 0);
const radial = new THREE.Vector3(1, 0, 0);

assert.equal(RADIAL_LAYOUT_LINK_LENGTH, RADIAL_LAYOUT_NODE_RADIUS * 5, 'L must equal 5r');
assert.equal(RADIAL_LAYOUT_LINK_LENGTH, 36, 'r=7.2 therefore L=36');

const premise = positionsOnPerpendicularPlane(center, radial, 1, false)[0];
const conclusion = positionsOnPerpendicularPlane(center, radial, 1, true)[0];
assert.ok(Math.abs(premise.distanceTo(center) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON);
assert.ok(Math.abs(conclusion.distanceTo(center) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON);
assert.ok(premise.x < center.x, 'single premise must point toward the ball centre');
assert.ok(conclusion.x > center.x, 'single conclusion must point outward');

const spread = positionsOnPerpendicularPlane(center, radial, 6, true);
const axial = spread[0].clone().sub(center).dot(radial);
for (const point of spread) {
  assert.ok(Math.abs(point.distanceTo(center) - RADIAL_LAYOUT_LINK_LENGTH) < EPSILON, 'each neighbour must remain exactly L from its owner');
  assert.ok(Math.abs(point.clone().sub(center).dot(radial) - axial) < EPSILON, 'expanded neighbours must lie on one plane perpendicular to the radial axis');
}
for (let index = 0; index < spread.length; index += 1) {
  const next = spread[(index + 1) % spread.length];
  assert.ok(spread[index].distanceTo(next) + EPSILON >= RADIAL_LAYOUT_MIN_PLANE_SPACING, 'adjacent expanded neighbours must respect x when geometrically feasible');
}

console.log('Radial knowledge layout formula checks passed');
