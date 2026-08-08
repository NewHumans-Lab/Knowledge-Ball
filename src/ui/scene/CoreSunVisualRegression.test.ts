import { CORE_SUN_GLOW_SCALE, CORE_SUN_LIGHT_DISTANCE, CORE_SUN_LIGHT_INTENSITY, CORE_SUN_RADIUS, SUN_ORBIT_RADIUS, SUN_RADIUS_MM } from '../config/KnowledgeUiConfig';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// The central visual Sun is intentionally twice the default ordinary-node radius (9).
assert(CORE_SUN_RADIUS === 18, 'central Sun radius must remain exactly 2x the default ordinary-node radius');
assert(CORE_SUN_RADIUS > SUN_ORBIT_RADIUS + SUN_RADIUS_MM, 'Sun must fully enclose the core triad');
assert(CORE_SUN_GLOW_SCALE >= 6, 'corona must remain visible at whole-graph scale');
assert(CORE_SUN_LIGHT_INTENSITY >= 20, 'central light must be visually meaningful');
assert(CORE_SUN_LIGHT_DISTANCE >= 400, 'central light must attenuate across a meaningful portion of the graph');

console.log('Core sun visual regression tests passed');
