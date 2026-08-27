import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync('src/ui/app.ts', 'utf8');
const entry = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const implementation = readFileSync('src/ui/scene/Deterministic5RLayout.ts', 'utf8');

assert(app.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"), 'user app must keep the narrow single layout entry point');
assert(entry.includes("from './Deterministic5RLayout'"), 'runtime entry must delegate only to the authoritative layout owner');
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
  'occupancyFromPlaced',
  'prior.offset += LAYOUT_UNIT',
]) {
  assert(!implementation.includes(forbidden), `forbidden legacy/obsolete strategy returned: ${forbidden}`);
}

assert(implementation.includes('CROSSING_SWEEP_LIMIT'), 'bounded crossing minimization must remain');
assert(implementation.includes('compactTriangularCoordinates'), 'branch geometry must retain the two-axis triangular local solve');
assert(implementation.includes('solveComponent(metadataComponent, graph)'), 'components must be solved progressively when they are about to be placed');
assert(implementation.includes('FccOccupancy'), 'global dedup/positioning must be FCC-based');
assert(implementation.includes('snapToNearestFcc'), 'ideal chain geometry must snap to the nearest FCC position');
assert(implementation.includes('FCC_AXIS_STEP'), 'FCC lattice must have an explicit R-scale basis');
assert(implementation.includes('EXCLUSION_RADIUS = 5 * KNOWLEDGE_BALL_RADIUS'), 'global dedup must reserve a 5R neighbourhood');
assert(implementation.includes('EXPANSION_UNIT = 5 * KNOWLEDGE_BALL_RADIUS'), 'outward expansion must still advance in 5R steps');
assert(implementation.includes('reservedCells'), 'diagnostics must expose the actually reserved FCC region');
assert(implementation.includes('boundaries.bluePurple - outer[0]!.depth * LAYOUT_UNIT'), 'Purple chains must anchor their innermost Purple node to the Blue/Purple shell');
assert(implementation.includes('boundaries.cyanBlue - inner[0]!.depth * LAYOUT_UNIT'), 'Cyan/Blue chains must anchor their starting Cyan node to the Cyan/Blue shell');
assert(implementation.includes('fibonacciDirections'), 'Fibonacci Sphere candidate directions must remain the direction authority');
assert(implementation.includes('icosahedronMacroDirections'), '12 fixed macro directions must remain');
assert(implementation.includes('mapMacroDirectionsToCandidates'), 'macro directions must map to Fibonacci candidates');
assert(implementation.includes('selectTopComponents'), 'top-12 macro-sector protection must remain bounded');
assert(implementation.includes('processingOrder = [...metadata].sort(compareHardness)'), 'placement must proceed from the most complex components downward');
assert(implementation.includes('seededPermutation'), 'candidate orders must remain deterministic');
assert(implementation.includes('radialExtra += EXPANSION_UNIT'), 'failed placement must expand the current search radius in 5R increments');
assert(implementation.includes('purpleOuter: null'), 'Purple must remain semantically unbounded');

console.log('Single-owner Fibonacci + R-resolution FCC progressive-layout architecture checks passed.');
