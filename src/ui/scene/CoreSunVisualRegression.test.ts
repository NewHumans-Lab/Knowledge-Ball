import { readFileSync } from 'node:fs';
import {
  CORE_AMBIENT_LIGHT_INTENSITY,
  CORE_SUN_COLOR,
  CORE_SUN_GLOW_SCALE,
  CORE_SUN_LIGHT_DECAY,
  CORE_SUN_LIGHT_DISTANCE,
  CORE_SUN_LIGHT_INTENSITY,
  CORE_SUN_RADIUS,
  CORE_SUN_SHADOW_FAR,
  KNOWLEDGE_SCENE_THEME,
  LAYER_BANDS,
  MAX_GRAPH_ZOOM,
  SUN_ORBIT_RADIUS,
  SUN_RADIUS_MM,
} from '../config/KnowledgeUiConfig';
import {
  SYSTEM_CORE_DEFINITIONS,
  createSystemCoreSceneNodes,
  systemCoreDisplayContent,
} from '../systemCore/SystemCoreContent';
import { setLocale } from '../../i18n/Locale';
import { createCoreSunLight, displayLabelForNode } from './KnowledgeScene';
import {
  STABLE_LABEL_MAX,
  STABLE_LABEL_WHITELIST,
  selectStableShellLabels,
  type StableShellLabelCandidate,
} from './StableShellLabelBudget';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(CORE_SUN_RADIUS === 18, 'central Sun radius must remain exactly 2x the default ordinary-node radius');
assert(CORE_SUN_RADIUS > SUN_ORBIT_RADIUS + SUN_RADIUS_MM, 'Sun must fully enclose the core triad');
assert(CORE_SUN_GLOW_SCALE === KNOWLEDGE_SCENE_THEME.sun.coronaScale, 'runtime corona scale must come from the canonical scene theme');
assert(CORE_SUN_GLOW_SCALE >= 3 && CORE_SUN_GLOW_SCALE <= 4.5, 'corona must remain visible without washing most of a phone viewport in cyan haze');
assert(KNOWLEDGE_SCENE_THEME.sun.haloScale > CORE_SUN_GLOW_SCALE && KNOWLEDGE_SCENE_THEME.sun.haloScale <= 6, 'violet halo must extend beyond the corona but remain visually restrained');
assert(CORE_SUN_COLOR === 0xFFFFFF, 'central Sun surface and point light must use neutral white');
assert(CORE_SUN_LIGHT_INTENSITY >= 20, 'central light must be visually meaningful');
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

setLocale('zh-CN');
assert(displayLabelForNode({ id: 'n1', title: 'Law of Identity' }) === '同一律', 'Chinese n1 label must be only the localized name');
assert(displayLabelForNode({ id: 'n2', title: 'Law of Excluded Middle' }) === '排中律', 'Chinese n2 label must be only the localized name');
assert(displayLabelForNode({ id: 'n16', title: 'Law of Non-Contradiction' }) === '矛盾律', 'Chinese n16 label must be only the localized name');
assert(!displayLabelForNode({ id: 'n1', title: 'Law of Identity' }).includes('A = A'), 'logic symbols must not be injected into core labels');
const chineseIdentity = systemCoreDisplayContent('n1', 'zh-CN');
assert(chineseIdentity?.formula === 'A = A', 'core detail must retain the logic formula');
assert(chineseIdentity?.title === '同一律', 'core detail title must localize to Chinese');
assert(chineseIdentity?.description.includes('自身相同'), 'core detail explanation must localize to Chinese');

setLocale('en');
assert(displayLabelForNode({ id: 'n1', title: '同一律' }) === 'Law of Identity', 'English n1 label must localize back to English');
assert(displayLabelForNode({ id: 'n2', title: '排中律' }) === 'Law of Excluded Middle', 'English n2 label must localize back to English');
assert(displayLabelForNode({ id: 'n16', title: '矛盾律' }) === 'Law of Non-Contradiction', 'English n16 label must localize back to English');
assert(displayLabelForNode({ id: 'n3', title: '质数的定义' }) === '质数的定义', 'non-core labels must remain unchanged');
setLocale('zh-CN');

assert([...STABLE_LABEL_WHITELIST].sort().join(',') === 'n1,n16,n2', 'core label whitelist must contain exactly the three system-core ids');
const ordinaryCandidates: StableShellLabelCandidate[] = Array.from({ length: 24 }, (_, index) => ({
  id: `ordinary-${index}`,
  x: 20 + (index % 4) * 90,
  y: 40 + Math.floor(index / 4) * 110,
  shellRadius: 1_000 - index,
}));
const coreCandidates: StableShellLabelCandidate[] = [
  { id: 'n1', x: 175, y: 380, shellRadius: 3.2 },
  { id: 'n2', x: 195, y: 405, shellRadius: 3.2 },
  { id: 'n16', x: 215, y: 380, shellRadius: 3.2 },
];
const previousOrdinaryBudget = new Set(ordinaryCandidates.slice(0, STABLE_LABEL_MAX).map(candidate => candidate.id));
const whitelistBudget = selectStableShellLabels([...ordinaryCandidates, ...coreCandidates], previousOrdinaryBudget, 390, 844);
assert(whitelistBudget.size === STABLE_LABEL_MAX, 'core whitelist must stay inside the existing 18-label cap');
assert(coreCandidates.every(candidate => whitelistBudget.has(candidate.id)), 'all eligible core labels must displace ordinary labels instead of being budget-eliminated');
assert([...whitelistBudget].filter(id => id.startsWith('ordinary-')).length === STABLE_LABEL_MAX - coreCandidates.length, 'whitelisted core labels must consume normal budget slots');

assert(SYSTEM_CORE_DEFINITIONS.length === 3, 'system core must contain exactly three code-only definitions');
assert(SYSTEM_CORE_DEFINITIONS.every(core => core.author === 'Knowledge Ball'), 'every system core card must use Knowledge Ball as author');
assert(SYSTEM_CORE_DEFINITIONS.map(core => core.id).join(',') === 'n1,n2,n16', 'system core ids must preserve the existing visual triad ids');
const systemCoreNodes = createSystemCoreSceneNodes();
assert(systemCoreNodes.every(node => node.premises.length === 0), 'system core nodes must never expose premise edges');
assert(systemCoreNodes.every(node => node.status === 'verified'), 'system core visual nodes must have a fixed non-review visual state');
assert(systemCoreNodes.every(node => node.effectiveLayer === 'core'), 'system core visual nodes must stay in the core layer');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const demoSource = readFileSync('src/demo/seedDemoKnowledge.ts', 'utf8');
const physicsStart = sceneSource.indexOf('const physics =');
const labelsStart = sceneSource.indexOf('const labels =');
const physicsSource = sceneSource.slice(physicsStart, labelsStart);
assert(sceneSource.includes('const updateCoreOrbit = (timeMs: number) =>'), 'core orbit must have a dedicated updater independent of ordinary graph physics');
assert(!physicsSource.includes('coreOrbitScreenPosition'), 'ordinary graph physics must not own the core orbit anymore');
assert(sceneSource.includes('const systemCoreNodes: KnowledgeSceneNode[] = createSystemCoreSceneNodes();'), 'scene must inject the fixed core without using GraphProjection');
assert(sceneSource.includes('openSystemCoreCard(nodeId'), 'core taps must open the static system-core card instead of the public panel');
assert(!sceneSource.includes('CORE_NODE_ENGLISH_LABELS'), 'scene must not own a forced-English core-label table');
assert(sceneSource.includes('return systemCoreLabel(node.id) ?? node.title;'), 'scene labels must read the current system-core locale');
assert(!demoSource.includes("await addAtomic('n1'"), 'demo seed must not write Law of Identity into the event stream');
assert(!demoSource.includes("await addAtomic('n2'"), 'demo seed must not write Law of Excluded Middle into the event stream');
assert(!demoSource.includes("await addAtomic('n16'"), 'demo seed must not write Law of Non-Contradiction into the event stream');
assert(!demoSource.includes("['n1', 'n2']"), 'demo reasoning must not use system core as public premises');
const largeIdleStart = sceneSource.indexOf('if (largeMobileGraph && !largeGraphDirty && !sceneWorkDirty)');
const largeIdleEnd = sceneSource.indexOf('const dt = Math.min(clock.getDelta(), .05);', largeIdleStart);
const largeIdleSource = sceneSource.slice(largeIdleStart, largeIdleEnd);
assert(largeIdleSource.includes('updateCoreOrbit(time);'), 'large mobile graph idle frames must continue advancing the core orbit');
assert(largeIdleSource.includes('renderer.render(scene, camera);'), 'large mobile graph idle frames must render the advancing core orbit');

console.log('Core sun visual regression tests passed');
