import {
  CORE_AMBIENT_LIGHT_INTENSITY,
  CORE_SUN_COLOR,
  CORE_SUN_GLOW_SCALE,
  CORE_SUN_LIGHT_DECAY,
  CORE_SUN_LIGHT_DISTANCE,
  CORE_SUN_LIGHT_INTENSITY,
  CORE_SUN_RADIUS,
  CORE_SUN_SHADOW_FAR,
  LAYER_BANDS,
  MAX_GRAPH_ZOOM,
  SUN_ORBIT_RADIUS,
  SUN_RADIUS_MM,
} from '../config/KnowledgeUiConfig';
import { createCoreSunLight } from './KnowledgeScene';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(CORE_SUN_RADIUS === 18, 'central Sun radius must remain exactly 2x the default ordinary-node radius');
assert(CORE_SUN_RADIUS > SUN_ORBIT_RADIUS + SUN_RADIUS_MM, 'Sun must fully enclose the core triad');
assert(CORE_SUN_GLOW_SCALE >= 6, 'corona must remain visible at whole-graph scale');
assert(CORE_SUN_COLOR === 0xFFFFFF, 'central Sun surface, corona and light must use neutral white');
assert(CORE_SUN_LIGHT_INTENSITY >= 20, 'central light must be visually meaningful');
// Three.js uses distance=0 + decay=2 for physically-correct inverse-square attenuation with no artificial cutoff.
assert(CORE_SUN_LIGHT_DISTANCE === 0, 'PointLight distance must be zero so no artificial cutoff modifies inverse-square attenuation');
assert(CORE_SUN_LIGHT_DECAY === 2, 'PointLight decay must remain inverse-square');
assert(CORE_AMBIENT_LIGHT_INTENSITY === 0, 'uniform ambient light must not bypass distance attenuation or occlusion');
assert(CORE_SUN_SHADOW_FAR > LAYER_BANDS.outer.rMax * MAX_GRAPH_ZOOM, 'shadow camera must cover every graph layer at maximum zoom');

const light = createCoreSunLight();
assert(light.color.getHex() === CORE_SUN_COLOR, 'runtime point light color must exactly match the Sun color');
assert(light.distance === CORE_SUN_LIGHT_DISTANCE, 'runtime point light must not introduce a finite cutoff');
assert(light.decay === CORE_SUN_LIGHT_DECAY, 'runtime point light must use inverse-square decay');
assert(light.castShadow, 'runtime point light must cast shadows so foreground balls can occlude it');
assert(light.shadow.camera.far === CORE_SUN_SHADOW_FAR, 'runtime shadow camera must use the dedicated full-range shadow distance');
assert(light.shadow.mapSize.width === 512 && light.shadow.mapSize.height === 512, 'point-light shadow map must stay enabled at the intended mobile-safe resolution');

console.log('Core sun visual regression tests passed');
