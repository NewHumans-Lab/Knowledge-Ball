import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync('src/ui/app.ts', 'utf8');
const entry = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const implementation = readFileSync('src/ui/scene/Deterministic5RLayout.ts', 'utf8');

assert(app.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must keep the narrow single layout entry point');
assert(entry.includes("from './Deterministic5RLayout'"), 'runtime entry must delegate only to the new authoritative owner');
assert(!existsSync('src/ui/scene/RadialKnowledgeLayout.ts'), 'old radial owner must stay removed');
assert(!existsSync('src/ui/scene/TriangularRelationGroupPacking.ts'), 'old packing owner must stay removed');

for (const forbidden of [
  'forceDirected',
  'nearestFree',
  'edgeTotal(',
  'tangent stagger',
  'applyTriangularRelationGroupPacking',
  'applyRadialKnowledgeLayout',
  'minGap',
  'Math.random()',
  'candidates.length > 512',
]) {
  assert(!implementation.includes(forbidden), `forbidden legacy/shortcut strategy returned: ${forbidden}`);
}

assert(implementation.includes('CROSSING_SWEEP_LIMIT'), 'bounded crossing minimization must remain');
assert(implementation.includes('compactTriangularCoordinates'), 'same-depth geometry must use the real two-axis triangular template');
assert(implementation.includes('SpatialOccupancy'), '5R occupancy must be indexed rather than coordinate de-duplication');
assert(implementation.includes('distanceToSquared'), 'indexed occupancy must perform an exact distance threshold check');
assert(implementation.includes('icosahedronMacroDirections'), '12 fixed macro directions must remain');
assert(implementation.includes('mapMacroDirectionsToCandidates'), 'macro directions must map to distinct Fibonacci candidates');
assert(implementation.includes('selectTopComponents'), 'only a bounded top-K set receives macro-sector protection');
assert(implementation.includes('seededPermutation'), 'ordinary and macro assignments must use deterministic seeded permutations');
assert(implementation.includes('tried.clear()'), 'component-local failed candidates must be retried after a +L expansion rather than globally consumed');
assert(implementation.includes('prior.offset += LAYOUT_UNIT'), 'radial expansion must move existing components outward by exactly L');
assert(implementation.includes('occupancy = occupancyFromPlaced(placed)'), 'expansion must rebuild occupancy from final rigidly translated positions');
assert(implementation.includes('purpleOuter: null'), 'purple must remain semantically unbounded');

console.log('Single-owner deterministic 5R runtime architecture checks passed.');
