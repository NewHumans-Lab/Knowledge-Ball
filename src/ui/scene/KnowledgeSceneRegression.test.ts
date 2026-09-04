import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import {
  clampGraphZoom,
  colorForNode,
  coreLabelsVisible,
  coreOrbitScreenPosition,
  coreSunContainsTriad,
  hasFiniteCoordinates,
  initialNodePosition,
  isCoreNodeId,
  layerForNode,
  nodeRadiusForType,
  ordinaryNodeCompensationScale,
  pendingPulseAtCycleMs,
  pendingPulsePhaseMs,
  shouldRenderEdge,
} from './KnowledgeScene';
import {
  STABLE_LABEL_MAX,
  STABLE_LABEL_MIN,
  selectStableShellLabels,
  type StableShellLabelCandidate,
} from './StableShellLabelBudget';
import { nodeScreenGeometryFromNdc } from './NodeScreenGeometry';
import {
  CORE_AMBIENT_LIGHT_INTENSITY,
  CORE_SUN_LIGHT_INTENSITY,
  CORE_SUN_RADIUS,
  DEFAULT_CAM_Z,
  KNOWLEDGE_SCENE_THEME,
  LAYER_BANDS,
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  NODE_LAYER_COLOR,
  NODE_SPECIAL_COLOR,
  PENDING_PULSE_FADE_MS,
  PENDING_PULSE_LOW_MS,
  PENDING_PULSE_MIN_OPACITY,
  PENDING_PULSE_MIN_SCALE,
  PENDING_PULSE_PERIOD_MS,
  PENDING_PULSE_RISE_MS,
  PENDING_PULSE_VISIBLE_MS,
  SUN_ORBIT_RADIUS,
  SUN_RADIUS_MM,
  SUN_TRIAD_IDS,
} from '../config/KnowledgeUiConfig';

type TestType = 'axiom'|'definition'|'fact'|'theorem'|'hypothesis'|'prediction'|'opinion'|'value'|'reasoning'|'logic-symbol';
type TestStatus = 'pending'|'verified'|'suspended'|'disputed'|'falsified';
function node(id: string, type: TestType = 'fact', status: TestStatus = 'verified') {
  return { id, type, status } as const;
}
function rgb(hex: number) { return { r:(hex>>16)&255, g:(hex>>8)&255, b:hex&255 }; }

for (const id of SUN_TRIAD_IDS) {
  assert(isCoreNodeId(id), `${id} must be core`);
  assert.equal(layerForNode(node(id, 'axiom')), 'core');
  assert.equal(shouldRenderEdge(id, 'ordinary'), false, `core edge ${id}->ordinary must be suppressed`);
  assert.equal(shouldRenderEdge('ordinary', id), false, `core edge ordinary->${id} must be suppressed`);
}
assert(shouldRenderEdge('a', 'b'), 'ordinary canonical-chain edges must remain visible');
assert(CORE_SUN_RADIUS > SUN_ORBIT_RADIUS + SUN_RADIUS_MM, 'core sun must fully enclose the triad orbit');
assert(coreSunContainsTriad(), 'core sun containment invariant failed');
for (const angle of [0, .7, 2.4, 5.9]) {
  const points = SUN_TRIAD_IDS.map((_, index) => coreOrbitScreenPosition(index, angle));
  const centroid = points.reduce((sum, point) => sum.add(point), points[0].clone().set(0,0,0)).multiplyScalar(1 / points.length);
  assert(centroid.length() < 1e-10, 'core triad projected centroid must remain centered');
  for (const point of points) {
    assert(Math.abs(point.z) < 1e-12, 'core triad orbit must remain camera-facing');
    assert(Math.abs(point.length() - SUN_ORBIT_RADIUS) < 1e-10, 'core triad must retain orbital radius');
  }
}
assert(CORE_SUN_LIGHT_INTENSITY > 1, 'core light must remain available for the sun visual system');
assert.equal(CORE_AMBIENT_LIGHT_INTENSITY, 0, 'ordinary semantic shells must not depend on ambient light');

assert.equal(layerForNode(node('definition','definition')), 'inner');
assert.equal(layerForNode(node('fact','fact')), 'inner');
assert.equal(layerForNode(node('axiom','axiom')), 'middle');
assert.equal(layerForNode(node('theorem','theorem')), 'middle');
for (const type of ['hypothesis','prediction','opinion','value'] as const) assert.equal(layerForNode(node(`outer-${type}`, type)), 'outer');
assert.equal(layerForNode(node('pending-definition','definition','pending')), 'outer');
assert.equal(layerForNode(node('disputed-theorem','theorem','disputed')), 'outer');

assert.equal(colorForNode(node('inner-definition','definition')), NODE_LAYER_COLOR.inner);
assert.equal(colorForNode(node('middle-theorem','theorem')), NODE_LAYER_COLOR.middle);
assert.equal(colorForNode(node('outer-hypothesis','hypothesis')), NODE_LAYER_COLOR.outer);
assert.equal(colorForNode(node('reasoning-verified','reasoning')), NODE_SPECIAL_COLOR.structural, 'reasoning-process balls must remain white real nodes');
assert.equal(colorForNode(node('reasoning-pending','reasoning','pending')), NODE_SPECIAL_COLOR.structural, 'pending reasoning remains white while pulse carries pending state');
assert.equal(colorForNode(node('falsified-reasoning','reasoning','falsified')), NODE_SPECIAL_COLOR.falsified);

const middleRgb = rgb(KNOWLEDGE_SCENE_THEME.node.middle);
const innerRgb = rgb(KNOWLEDGE_SCENE_THEME.node.inner);
assert(middleRgb.b - middleRgb.g >= 60 && middleRgb.b > middleRgb.r, 'middle-layer color must read as blue');
assert(innerRgb.b >= innerRgb.g && innerRgb.g > innerRgb.r, 'inner-layer color may be icy cyan but not green-dominant');
assert.equal(KNOWLEDGE_SCENE_THEME.node.shellOpacity, 1, 'ordinary semantic shell stays opaque');
assert(KNOWLEDGE_SCENE_THEME.node.pointOpacity <= .6, 'semantic aura remains secondary');
assert(KNOWLEDGE_SCENE_THEME.node.sphereWidthSegments >= 24 && KNOWLEDGE_SCENE_THEME.node.sphereHeightSegments >= 16, 'sphere geometry must remain smooth');
assert.equal(KNOWLEDGE_SCENE_THEME.node.matcapLight, 255);
assert(KNOWLEDGE_SCENE_THEME.node.matcapDark < KNOWLEDGE_SCENE_THEME.node.matcapMid && KNOWLEDGE_SCENE_THEME.node.matcapMid < KNOWLEDGE_SCENE_THEME.node.matcapLight, 'matcap must retain a bounded depth ramp');
assert(KNOWLEDGE_SCENE_THEME.renderer.antialias, 'WebGL antialiasing must remain enabled');
assert(KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio >= 1 && KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio <= 1.5, 'mobile pixel ratio must remain bounded');
assert.equal(KNOWLEDGE_SCENE_THEME.mastery.tint, 0xFFFFFF);
assert.equal(KNOWLEDGE_SCENE_THEME.edge.normal, 0xB9D8F5);
assert.equal(KNOWLEDGE_SCENE_THEME.edge.active, 0xD9ECFF);
assert.equal(KNOWLEDGE_SCENE_THEME.edge.normalOpacity, .5);
assert.equal(KNOWLEDGE_SCENE_THEME.edge.activeOpacity, .5);
assert.equal(KNOWLEDGE_SCENE_THEME.edge.inactiveFactor, 1);
assert.equal('logic' in KNOWLEDGE_SCENE_THEME.edge, false, 'obsolete logic edge class must stay removed from the theme');
assert.equal('twin' in KNOWLEDGE_SCENE_THEME.edge, false, 'obsolete twin UI metadata must never become a scene line again');
assert.equal('twinOpacity' in KNOWLEDGE_SCENE_THEME.edge, false, 'obsolete twin edge opacity must stay removed from the theme');

let sawMeaningfulZ = false;
for (const sample of [node('inner-a','definition'), node('inner-b','fact'), node('middle-a','axiom'), node('middle-b','theorem'), node('outer-a','hypothesis'), node('outer-b','theorem','pending')]) {
  const layer = layerForNode(sample);
  const pos = initialNodePosition(sample);
  const radius = pos.length();
  if (layer !== 'core') {
    const band = LAYER_BANDS[layer];
    assert(radius >= band.rMin - 1e-9 && radius <= band.rMax + 1e-9, `${sample.id} outside ${layer} volume`);
    if (Math.abs(pos.z) > radius * .15) sawMeaningfulZ = true;
    assert(pos.distanceTo(initialNodePosition(sample)) < 1e-12, `${sample.id} layout must be deterministic`);
  }
}
assert(sawMeaningfulZ, 'layout regressed toward a flat XY disk');
assert.equal(clampGraphZoom(0), MIN_GRAPH_ZOOM);
assert.equal(clampGraphZoom(999), MAX_GRAPH_ZOOM);
assert(Math.abs(ordinaryNodeCompensationScale(4) - .25) < 1e-12, 'ordinary node geometry must inverse-scale');
assert.equal(nodeRadiusForType('reasoning', 9), 3, 'reasoning-process radius must be exactly one third of a conclusion radius');
assert.equal(nodeRadiusForType('theorem', 9), 9);
assert(!coreLabelsVisible(9.99) && coreLabelsVisible(10), 'core labels reveal only at 10x graph zoom');
assert.equal(DEFAULT_CAM_Z, 640);
assert(hasFiniteCoordinates({x:0,y:-1,z:2}));
assert(!hasFiniteCoordinates({x:Number.NaN,y:0,z:0}));
assert(!hasFiniteCoordinates({x:0,y:Number.POSITIVE_INFINITY,z:0}));

const portraitScreenGeometry = nodeScreenGeometryFromNdc(
  { x: 0, y: 0 },
  { x: 0, y: .2 },
  { width: 390, height: 844 },
);
assert(Math.abs(portraitScreenGeometry.centerX - 195) < 1e-9);
assert(Math.abs(portraitScreenGeometry.centerY - 422) < 1e-9);
assert(Math.abs(portraitScreenGeometry.radiusPx - 84.4) < 1e-9);
assert(Math.abs(portraitScreenGeometry.topY - (portraitScreenGeometry.centerY - portraitScreenGeometry.radiusPx)) < 1e-9, 'label anchor must be centerY - radiusPx');
const doubledScreenGeometry = nodeScreenGeometryFromNdc(
  { x: 0, y: 0 },
  { x: 0, y: .2 },
  { width: 780, height: 1688 },
);
assert(Math.abs(doubledScreenGeometry.radiusPx - portraitScreenGeometry.radiusPx * 2) < 1e-9, 'radius must scale with the canvas CSS viewport');
assert(Math.abs(doubledScreenGeometry.topY - portraitScreenGeometry.topY * 2) < 1e-9, 'sphere-top anchor must scale with the same canvas viewport');
const driftedRadiusSample = nodeScreenGeometryFromNdc(
  { x: .1, y: -.1 },
  { x: .12, y: .1 },
  { width: 412, height: 915 },
);
assert.equal(driftedRadiusSample.topX, driftedRadiusSample.centerX, 'label direction must stay vertically above the rendered center');
assert(driftedRadiusSample.topY < driftedRadiusSample.centerY, 'screen-space sphere top must always subtract radiusPx');

assert.equal(PENDING_PULSE_VISIBLE_MS + PENDING_PULSE_FADE_MS + PENDING_PULSE_LOW_MS + PENDING_PULSE_RISE_MS, PENDING_PULSE_PERIOD_MS);
const visiblePulse = pendingPulseAtCycleMs(0);
assert.equal(visiblePulse.opacityFactor, 1);
assert.equal(visiblePulse.scale, 1);
const fadeMid = pendingPulseAtCycleMs(PENDING_PULSE_VISIBLE_MS + PENDING_PULSE_FADE_MS / 2);
assert(fadeMid.opacityFactor < 1 && fadeMid.opacityFactor > PENDING_PULSE_MIN_OPACITY);
assert(fadeMid.scale < 1 && fadeMid.scale > PENDING_PULSE_MIN_SCALE);
const lowPulse = pendingPulseAtCycleMs(PENDING_PULSE_VISIBLE_MS + PENDING_PULSE_FADE_MS + PENDING_PULSE_LOW_MS / 2);
assert(Math.abs(lowPulse.opacityFactor - PENDING_PULSE_MIN_OPACITY) < 1e-12);
assert(Math.abs(lowPulse.scale - PENDING_PULSE_MIN_SCALE) < 1e-12);
assert.equal(pendingPulseAtCycleMs(PENDING_PULSE_PERIOD_MS).opacityFactor, 1);
assert.equal(pendingPulsePhaseMs('pending-a'), pendingPulsePhaseMs('pending-a'));
assert(new Set(['pending-a','pending-b','pending-c','pending-d'].map(pendingPulsePhaseMs)).size > 1, 'pending nodes must not all share one phase');

const labelCandidates: StableShellLabelCandidate[] = Array.from({ length: 24 }, (_, index) => ({
  id: `label-${index}`,
  x: 45 + (index % 3) * 150,
  y: 50 + Math.floor(index / 3) * 100,
  shellRadius: 1_000 - index,
}));
const withOffscreen = [{ id: 'offscreen-outer', x: -10, y: 100, shellRadius: 10_000 }, ...labelCandidates];
const initialBudget = selectStableShellLabels(withOffscreen, new Set(), 390, 844);
assert.equal(initialBudget.size, STABLE_LABEL_MAX, 'more than 18 on-screen labels must be trimmed to 18');
assert(!initialBudget.has('offscreen-outer'), 'off-screen labels must never enter the budget even when their shell is outermost');
for (let index = 0; index < STABLE_LABEL_MAX; index += 1) {
  assert(initialBudget.has(`label-${index}`), 'outer shells must win before inner shells when spacing is legal');
}
const stableBand = new Set(Array.from({ length: 14 }, (_, index) => `label-${index + 4}`));
const stableResult = selectStableShellLabels(labelCandidates, stableBand, 390, 844);
assert.deepEqual([...stableResult].sort(), [...stableBand].sort(), '12..18 retained labels must not reshuffle');
const belowMinimum = new Set(Array.from({ length: 10 }, (_, index) => `label-${index}`));
const replenished = selectStableShellLabels(labelCandidates, belowMinimum, 390, 844);
assert.equal(replenished.size, STABLE_LABEL_MIN, 'fewer than 12 retained labels must be replenished only to 12');
assert(replenished.has('label-10') && replenished.has('label-11'), 'replenishment must add the outermost remaining legal shells first');
const tooMany = new Set(labelCandidates.map(candidate => candidate.id));
const trimmed = selectStableShellLabels(labelCandidates, tooMany, 390, 844);
assert.equal(trimmed.size, STABLE_LABEL_MAX, 'more than 18 retained labels must trim to 18');

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const syncEdgesStart = sceneSource.indexOf('const syncEdges =');
const visibilityStart = sceneSource.indexOf('const applyVisibility =');
assert(syncEdgesStart >= 0 && visibilityStart > syncEdgesStart, 'scene edge synchronizer must remain discoverable');
const syncEdgesSource = sceneSource.slice(syncEdgesStart, visibilityStart);
assert(syncEdgesSource.includes('relationIndexFor(nodes).edges'), 'scene must get horizontal lines from the canonical indexed domain chain');
assert(syncEdgesSource.includes('new THREE.LineBasicMaterial'), 'canonical chain lines must use one ordinary line material');
assert(!syncEdgesSource.includes('LineDashedMaterial'), 'legacy twin dashed-line renderer must stay removed');
assert(!syncEdgesSource.includes('logicRuleId'), 'logic-rule metadata must never become a scene line again');
assert(!syncEdgesSource.includes('twinGroup'), 'legacy twin UI metadata must never become a scene line again');
assert(syncEdgesSource.includes('selectedId === from.id || selectedId === to.id'), 'only lines incident to the selected real node may receive active color');
assert(syncEdgesSource.includes('material.color.setHex(relationActive ? KNOWLEDGE_SCENE_THEME.edge.active : KNOWLEDGE_SCENE_THEME.edge.normal)'), 'line color must switch only between canonical ordinary/active colors');
assert(/\.geometry\.setFromPoints\(\[a!\.clone\(\),\s*b!\.clone\(\)\]\)/.test(sceneSource), 'relation geometry must contain exactly two 3D endpoints');
assert(!sceneSource.includes('QuadraticBezierCurve3'), 'knowledge relations stay straight');
assert(!sceneSource.includes('forceContextLoss'), 'scene must never force WebGL context loss');
assert(!sceneSource.includes('forceContextRestore'), 'scene must never force WebGL context restoration');
assert(!sceneSource.includes('domElement.remove'), 'renderer canvas must remain attached');
assert(/const\s+pauseFrameLoop\s*=/.test(sceneSource));
assert(/const\s+resumeFrameLoop\s*=/.test(sceneSource));
assert(/const\s+down\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource));
assert(/const\s+move\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible/.test(sceneSource));
assert(/const\s+up\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource));
assert(/const\s+wheel\s*=\s*\(e:\s*WheelEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource));
assert(sceneSource.includes('callbacks.onNodeTap(nodeId)'), 'node tap must emit only through the node-tap callback');
const upStart = sceneSource.indexOf('const up =');
const wheelStart = sceneSource.indexOf('const wheel =');
assert(upStart >= 0 && wheelStart > upStart, 'pointer-up interaction block must remain discoverable');
const upSource = sceneSource.slice(upStart, wheelStart);
assert(!upSource.includes('focusNode(nodeId)'), 'ordinary real-ball tap must not rotate/focus the graph before opening detail');
assert(!sceneSource.includes('focusNode'), 'automatic/programmatic node focus must stay removed from the scene API and implementation');
assert(!sceneSource.includes('focusedNodeId'), 'focused-node identity state from the old two-tap flow must stay removed');
assert(!sceneSource.includes('focusTargetQuaternion'), 'automatic quaternion focus target from the old centering flow must stay removed');
assert(!sceneSource.includes('updateNodeFocus'), 'automatic focus animation loop from the old centering flow must stay removed');
const detailSetterStart = sceneSource.indexOf('setDetailNode: id =>');
const resizeSetterStart = sceneSource.indexOf('    resize,', detailSetterStart);
assert(detailSetterStart >= 0 && resizeSetterStart > detailSetterStart, 'detail scene-state setter must remain discoverable');
assert(!sceneSource.slice(detailSetterStart, resizeSetterStart).includes('focusNode(id)'), 'detail open/navigation must never rotate the graph');
assert(!sceneSource.includes('focusedRecord'), 'focused-node hit-test priority patch must stay removed with the centering flow');
assert(/\.shell\.visible\s*=\s*true/.test(sceneSource), 'large mobile graphs must retain opaque semantic node bodies');
assert(/\.point\.visible\s*=\s*!core/.test(sceneSource), 'semantic aura remains independent of the node body');
assert(/const\s+pending\s*=\s*!core\s*&&\s*nodeShouldPulse\(n\)/.test(sceneSource), 'only non-core pending/revalidating nodes may pulse');
assert(!sceneSource.includes('setInterval'), 'pending pulse must never create per-node intervals');
assert(sceneSource.includes('new THREE.MeshMatcapMaterial'), 'ordinary semantic nodes must use unlit matcap shading');
assert(/matcap:\s*nodeMatcapTex/.test(sceneSource), 'ordinary shells must share the neutral matcap');
assert(/antialias:\s*KNOWLEDGE_SCENE_THEME\.renderer\.antialias/.test(sceneSource));
assert(sceneSource.includes('KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio'));
const labelsStart = sceneSource.indexOf('const labels =');
const pickStart = sceneSource.indexOf('const pick =');
assert(labelsStart >= 0 && pickStart > labelsStart, 'label projection block must remain discoverable');
const labelsSource = sceneSource.slice(labelsStart, pickStart);
assert(labelsSource.includes('const frontFacing = isCoreNodeId(n.id) || worldPos.dot(camera.position) > 0;'), 'ordinary labels must be limited to the camera-facing hemisphere while core labels keep their own rule');
assert(labelsSource.includes('&& frontFacing'), 'front-facing status must participate directly in label display');
assert(labelsSource.includes('selectStableShellLabels'), 'large-mobile labels must use the stable shell-priority 12..18 selector');
assert(!labelsSource.includes('index % 4'), 'large-mobile labels must not fall back to arbitrary index thinning');
assert(labelsSource.includes('record.shell.getWorldScale(shellWorldScale)'), 'screen radius measurement must read the sphere current rendered size');
assert(labelsSource.includes('radiusSampleWorld.copy(worldPos).addScaledVector(cameraUp, renderedSphereRadius)'), '3D camera-up sample may measure radius but must not own final label placement');
assert(labelsSource.includes('const screenGeometry = nodeScreenGeometryFromNdc('), 'labels must cross the explicit 3D-to-screen geometry boundary');
assert(labelsSource.includes('x: screenGeometry.topX,'), 'label x must come only from screen geometry');
assert(labelsSource.includes('y: screenGeometry.topY,'), 'label y must come only from centerY - radiusPx screen geometry');
assert(!labelsSource.includes('host.clientWidth'), 'label placement must not mix host dimensions with the canvas viewport');
assert(!labelsSource.includes('host.clientHeight'), 'label placement must not mix host dimensions with the canvas viewport');
assert(!sceneSource.includes('LABEL_SPHERE_GAP_PX'), 'scene must not keep a second pixel-gap authority');
assert(!labelsSource.includes('margin-top'), 'scene projection must not compensate label spacing through CSS assumptions');
assert(!labelsSource.includes("translate(-50%, 10px)"), 'legacy below-center label offset must stay removed');
assert(sceneSource.includes('if (mobilePerformance && isTextEntryElement(document.activeElement)) return;'), 'mobile text entry must suppress keyboard-driven scene resize');
const resizeStart = sceneSource.indexOf('const resize =');
const scheduleFrameStart = sceneSource.indexOf('const scheduleFrame =', resizeStart);
assert(resizeStart >= 0 && scheduleFrameStart > resizeStart, 'resize block must remain discoverable');
const resizeSource = sceneSource.slice(resizeStart, scheduleFrameStart);
assert(resizeSource.indexOf("setProperty('--app-height'") < resizeSource.indexOf('const viewport = canvasViewport();'), 'layout height must settle before measuring the canvas viewport');
assert(resizeSource.includes('camera.aspect = viewport.width / viewport.height;'), 'camera aspect must use the canvas viewport');
assert(resizeSource.includes('renderer.setSize(viewport.width, viewport.height, false);'), 'renderer drawing buffer must follow the canvas CSS viewport without creating another CSS size authority');
const labelPresentationSource = readFileSync('src/ui/KnowledgeLabelPresentation.css', 'utf8');
assert(labelPresentationSource.includes('transform: translate(-50%, -100%);'), 'dedicated label presentation must extend the label upward from the sphere-top coordinate');
assert(labelPresentationSource.includes('margin: 0;'), 'dedicated label presentation must not add a second vertical offset');
assert(!labelPresentationSource.includes('margin-top: 4px'), 'legacy +4px compensation must stay removed');
const applyNodeStylesStart = sceneSource.indexOf('const applyNodeStyles =');
const visibilitySource = sceneSource.slice(visibilityStart, applyNodeStylesStart);
assert(!visibilitySource.includes('dot(camera.position)'), 'hemisphere filtering is presentation-only and must not become node/edge visibility authority');

const interactionSource = readFileSync('src/ui/interaction/InteractionController.ts', 'utf8');
assert(interactionSource.includes("document.getElementById('setLabelSize')"), 'label-size setting must be wired to the runtime interaction layer');
assert(interactionSource.includes("document.documentElement.style.setProperty('--label-size', `${value}px`)"), 'label-size input must update the CSS variable consumed by every node label');

console.log('Knowledge scene canonical-chain regression tests passed');
