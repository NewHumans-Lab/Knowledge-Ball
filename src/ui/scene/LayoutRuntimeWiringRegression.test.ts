import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const app = readFileSync('src/ui/app.ts', 'utf8');
const entry = readFileSync('src/ui/scene/UniformLayerLayout.ts', 'utf8');
const implementation = readFileSync('src/ui/scene/Deterministic5RLayout.ts', 'utf8');
assert(app.includes("import { applyUniformLayerLayout } from './scene/UniformLayerLayout';"));
assert(entry.includes("from './Deterministic5RLayout'"), 'runtime entry delegates only to the new owner');
assert(!existsSync('src/ui/scene/RadialKnowledgeLayout.ts'), 'old radial owner must be removed');
assert(!existsSync('src/ui/scene/TriangularRelationGroupPacking.ts'), 'old packing owner must be removed');
for (const forbidden of ['forceDirected', 'nearestFree', 'edgeTotal(', 'tangent stagger', 'applyTriangularRelationGroupPacking', 'applyRadialKnowledgeLayout']) {
  assert(!implementation.includes(forbidden), `forbidden legacy strategy returned: ${forbidden}`);
}
assert(implementation.includes('CROSSING_SWEEP_LIMIT'));
assert(implementation.includes('usedAngles'));
assert(implementation.includes('occupied'));
assert(implementation.includes('prior.offset += LAYOUT_UNIT'));
console.log('Single-owner deterministic 5R runtime wiring checks passed.');
