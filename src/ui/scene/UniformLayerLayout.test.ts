import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import type { KnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import {
  applyUniformLayerLayout,
  layoutBandForLayer,
  uniformLayerSlots,
  type UniformLayoutNode,
} from './UniformLayerLayout';

type NonCoreLayer = Exclude<KnowledgeLayer, 'core'>;

function fixture(layer: NonCoreLayer, count: number, hiddenIndex = -1): UniformLayoutNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${layer}-${index}`,
    effectiveLayer: layer,
    hidden: index === hiddenIndex,
  }));
}

function xyz(node: UniformLayoutNode): [number, number, number] {
  assert(node.pos, `node ${node.id} is missing a layout position`);
  return [node.pos.x, node.pos.y, node.pos.z];
}

function nearestNeighbourCv(layer: NonCoreLayer, count: number): number {
  const points = uniformLayerSlots(layer, count);
  const nearest = points.map((point, index) => {
    let min = Number.POSITIVE_INFINITY;
    points.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      min = Math.min(min, point.distanceTo(other));
    });
    return min;
  });
  const mean = nearest.reduce((sum, value) => sum + value, 0) / nearest.length;
  const variance = nearest.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nearest.length;
  return Math.sqrt(variance) / mean;
}

for (const [layer, count] of [['inner', 7], ['middle', 14], ['outer', 37]] as const) {
  const first = fixture(layer, count);
  const second = fixture(layer, count);
  applyUniformLayerLayout(first);
  applyUniformLayerLayout(second);

  assert.deepEqual(first.map(xyz), second.map(xyz), `${layer} layout must be deterministic`);

  const { rMin, rMax } = layoutBandForLayer(layer);
  const radii = first.map(node => node.pos!.length()).sort((a, b) => a - b);
  radii.forEach((radius, index) => {
    assert(radius >= rMin - 1e-9 && radius <= rMax + 1e-9, `${layer} node left its hard shell`);
    const actualQuantile = (radius ** 3 - rMin ** 3) / (rMax ** 3 - rMin ** 3);
    const expectedQuantile = (index + 0.5) / count;
    assert(Math.abs(actualQuantile - expectedQuantile) < 1e-9, `${layer} radial volume strata are not uniform`);
  });

  const positiveZ = first.filter(node => node.pos!.z > 0).length;
  const negativeZ = first.filter(node => node.pos!.z < 0).length;
  assert(positiveZ > 0 && negativeZ > 0, `${layer} layout must use both hemispheres`);
  assert(nearestNeighbourCv(layer, count) < 0.16, `${layer} nearest-neighbour spacing is too uneven`);
}

const visibleHistory = fixture('outer', 9, -1);
const hiddenHistory = fixture('outer', 9, 4);
applyUniformLayerLayout(visibleHistory);
applyUniformLayerLayout(hiddenHistory);
assert.deepEqual(
  visibleHistory.map(xyz),
  hiddenHistory.map(xyz),
  'hidden history must keep occupying its original uniform slot',
);
assert(hiddenHistory[4].pos, 'hidden node must receive a real position even though it is not rendered');

const cores: UniformLayoutNode[] = ['n1', 'n2', 'n16'].map(id => ({ id, effectiveLayer: 'core' }));
applyUniformLayerLayout(cores);
assert(cores.every(node => node.pos && Number.isFinite(node.pos.length())), 'core nodes must remain finite');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const physicsMatch = /const\s+physics\s*=/.exec(sceneSource);
const labelsMatch = /const\s+labels\s*=/.exec(sceneSource);
assert(physicsMatch && labelsMatch && labelsMatch.index > physicsMatch.index, 'scene physics implementation must remain discoverable');
const physicsSource = sceneSource.slice(physicsMatch.index, labelsMatch.index);
assert(/n\.pos!\.copy\(n\.homePos!\)/.test(physicsSource), 'ordinary nodes must return to their fixed uniform slot');
assert(!physicsSource.includes('neighborCount'), 'uniform layout must not be deformed by neighbour repulsion');
assert(!physicsSource.includes('n.premises'), 'uniform layout must not yet optimize relation-line length');
assert(!physicsSource.includes('twinGroup'), 'uniform layout must not yet optimize twin-line length');

const appSource = readFileSync('src/ui/app.ts', 'utf8');
assert(appSource.includes('layoutNodes = domainNodes.map'), 'layout must be built from every projected node before visibility filtering');
assert(appSource.includes('applyUniformLayerLayout(layoutNodes)'), 'all projected nodes must participate in one global uniform-layout pass');
assert(appSource.includes('renderNodes = layoutNodes.filter'), 'scene membership must be applied only after occupancy positions are assigned');
assert(appSource.includes('nodeBelongsInLineageScene(node)'), 'formal gray/red lineage balls must remain in scene data while rejected audit-only and legacy hidden records stay excluded');

console.log('Uniform layer layout regression tests passed.');