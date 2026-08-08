import { initialNodePosition, isCoreNodeId, layerForNode, shouldRenderEdge } from './KnowledgeScene';
import { LAYER_BANDS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function node(id: string, type: 'axiom' | 'fact' | 'theorem' = 'fact', status: 'pending' | 'verified' = 'verified') {
  return { id, type, status } as const;
}

for (const id of SUN_TRIAD_IDS) {
  assert(isCoreNodeId(id), `${id} must be core`);
  assert(layerForNode(node(id, 'axiom')) === 'core', `${id} must stay in core layer`);
  assert(!shouldRenderEdge(id, 'ordinary'), `core edge ${id}->ordinary must be suppressed`);
  assert(!shouldRenderEdge('ordinary', id), `core edge ordinary->${id} must be suppressed`);
  for (const otherCore of SUN_TRIAD_IDS) {
    assert(!shouldRenderEdge(id, otherCore), `core-to-core edge ${id}->${otherCore} must be suppressed`);
  }
}
assert(shouldRenderEdge('a', 'b'), 'ordinary dependency edges must remain visible');

const samples = [
  node('inner-a', 'axiom'), node('inner-b', 'axiom'),
  node('middle-a', 'fact'), node('middle-b', 'theorem'),
  node('outer-a', 'fact', 'pending'), node('outer-b', 'theorem', 'pending'),
];

let sawMeaningfulZ = false;
for (const sample of samples) {
  const layer = layerForNode(sample);
  const pos = initialNodePosition(sample);
  const radius = pos.length();
  if (layer !== 'core') {
    const band = LAYER_BANDS[layer];
    assert(radius >= band.rMin - 1e-9 && radius <= band.rMax + 1e-9, `${sample.id} outside ${layer} volume`);
    if (Math.abs(pos.z) > radius * 0.15) sawMeaningfulZ = true;
    const again = initialNodePosition(sample);
    assert(pos.distanceTo(again) < 1e-12, `${sample.id} layout must be deterministic across reloads`);
  }
}
assert(sawMeaningfulZ, 'layout regressed toward a flat XY disk');

let positiveZ = 0;
let negativeZ = 0;
for (let i = 0; i < 200; i += 1) {
  const p = initialNodePosition(node(`volume-${i}`, 'fact'));
  if (p.z > 0) positiveZ += 1;
  if (p.z < 0) negativeZ += 1;
}
assert(positiveZ > 60 && negativeZ > 60, '3D distribution must occupy both hemispheres instead of a disk/cap');

console.log('Knowledge scene regression tests passed');
