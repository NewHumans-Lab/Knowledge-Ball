import { readFileSync, writeFileSync } from 'node:fs';

const scenePath = 'src/ui/scene/KnowledgeScene.ts';
const testPath = 'src/ui/scene/KnowledgeSceneRegression.test.ts';
const helperPath = 'src/ui/scene/NodeScreenGeometry.ts';

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Unable to locate ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`Expected unique ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

let scene = readFileSync(scenePath, 'utf8');
scene = replaceOnce(
  scene,
  "} from './StableShellLabelBudget';",
  "} from './StableShellLabelBudget';\nimport { nodeScreenGeometryFromNdc } from './NodeScreenGeometry';",
  'screen geometry import anchor',
);

const oldRendererInit = [
  '  const scene = new THREE.Scene();',
  '  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / Math.max(host.clientHeight, 1), .5, 8000);',
  '  camera.position.set(0, 0, DEFAULT_CAM_Z);',
  '  const renderer = new THREE.WebGLRenderer({ antialias: KNOWLEDGE_SCENE_THEME.renderer.antialias, alpha: true });',
  '  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobilePerformance ? KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio : KNOWLEDGE_SCENE_THEME.renderer.desktopPixelRatio));',
  '  renderer.setSize(host.clientWidth, host.clientHeight);',
  '  renderer.setClearColor(0x000000, 0);',
  '  renderer.shadowMap.enabled = !mobilePerformance;',
  '  renderer.shadowMap.type = THREE.PCFSoftShadowMap;',
  "  renderer.domElement.style.touchAction = 'none';",
  '  host.appendChild(renderer.domElement);',
].join('\n');
const newRendererInit = [
  '  const scene = new THREE.Scene();',
  '  const initialRect = host.getBoundingClientRect();',
  '  const initialWidth = Math.max(initialRect.width, 1);',
  '  const initialHeight = Math.max(initialRect.height, 1);',
  '  const camera = new THREE.PerspectiveCamera(50, initialWidth / initialHeight, .5, 8000);',
  '  camera.position.set(0, 0, DEFAULT_CAM_Z);',
  '  const renderer = new THREE.WebGLRenderer({ antialias: KNOWLEDGE_SCENE_THEME.renderer.antialias, alpha: true });',
  '  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobilePerformance ? KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio : KNOWLEDGE_SCENE_THEME.renderer.desktopPixelRatio));',
  '  renderer.setSize(initialWidth, initialHeight, false);',
  '  renderer.setClearColor(0x000000, 0);',
  '  renderer.shadowMap.enabled = !mobilePerformance;',
  '  renderer.shadowMap.type = THREE.PCFSoftShadowMap;',
  "  renderer.domElement.style.touchAction = 'none';",
  '  host.appendChild(renderer.domElement);',
  '  const canvasViewport = () => {',
  '    const rect = renderer.domElement.getBoundingClientRect();',
  '    return {',
  '      width: Math.max(rect.width, 1),',
  '      height: Math.max(rect.height, 1),',
  '    };',
  '  };',
].join('\n');
scene = replaceOnce(scene, oldRendererInit, newRendererInit, 'renderer initialization');

scene = scene.replaceAll('labelAnchorWorld', 'radiusSampleWorld');
scene = scene.replaceAll('labelAnchorProjected', 'radiusSampleProjected');

scene = replaceOnce(
  scene,
  "    cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();\n    const allNodes = getNodes();",
  "    cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();\n    const viewport = canvasViewport();\n    const allNodes = getNodes();",
  'label viewport measurement',
);

const oldRadiusProjection = [
  '      record.shell.getWorldScale(shellWorldScale);',
  '      const renderedSphereRadius = Math.max(Math.abs(shellWorldScale.x), Math.abs(shellWorldScale.y), Math.abs(shellWorldScale.z));',
  '      radiusSampleWorld.copy(worldPos).addScaledVector(cameraUp, renderedSphereRadius);',
  '      radiusSampleProjected.copy(radiusSampleWorld).project(camera);',
  '      const frontFacing = isCoreNodeId(n.id) || worldPos.dot(camera.position) > 0;',
  '      const onScreen = radiusSampleProjected.x >= -1 && radiusSampleProjected.x <= 1 && radiusSampleProjected.y >= -1 && radiusSampleProjected.y <= 1;',
].join('\n');
const newRadiusProjection = [
  '      record.shell.getWorldScale(shellWorldScale);',
  '      const renderedSphereRadius = Math.max(Math.abs(shellWorldScale.x), Math.abs(shellWorldScale.y), Math.abs(shellWorldScale.z));',
  '      radiusSampleWorld.copy(worldPos).addScaledVector(cameraUp, renderedSphereRadius);',
  '      radiusSampleProjected.copy(radiusSampleWorld).project(camera);',
  '      const screenGeometry = nodeScreenGeometryFromNdc(',
  '        { x: projectedPos.x, y: projectedPos.y },',
  '        { x: radiusSampleProjected.x, y: radiusSampleProjected.y },',
  '        viewport,',
  '      );',
  '      const frontFacing = isCoreNodeId(n.id) || worldPos.dot(camera.position) > 0;',
  '      const onScreen = screenGeometry.topX >= 0 && screenGeometry.topX <= viewport.width',
  '        && screenGeometry.topY >= 0 && screenGeometry.topY <= viewport.height;',
].join('\n');
scene = replaceOnce(scene, oldRadiusProjection, newRadiusProjection, 'screen-space radius projection');
scene = replaceOnce(
  scene,
  '        x: (projectedPos.x * .5 + .5) * host.clientWidth,\n        y: (-radiusSampleProjected.y * .5 + .5) * host.clientHeight,',
  '        x: screenGeometry.topX,\n        y: screenGeometry.topY,',
  'label screen coordinates',
);
scene = replaceOnce(
  scene,
  '      visibleLabelIds = selectStableShellLabels(candidates, visibleLabelIds, host.clientWidth, host.clientHeight);',
  '      visibleLabelIds = selectStableShellLabels(candidates, visibleLabelIds, viewport.width, viewport.height);',
  'label budget viewport',
);

const oldResize = [
  '  const resize = () => {',
  '    if (mobilePerformance && isTextEntryElement(document.activeElement)) return;',
  '    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);',
  '    camera.updateProjectionMatrix();',
  '    renderer.setSize(host.clientWidth, host.clientHeight);',
  "    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);",
  '    largeGraphDirty = true;',
  '    graphDirty = true;',
  '  };',
].join('\n');
const newResize = [
  '  const resize = () => {',
  '    if (mobilePerformance && isTextEntryElement(document.activeElement)) return;',
  "    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);",
  '    const viewport = canvasViewport();',
  '    camera.aspect = viewport.width / viewport.height;',
  '    camera.updateProjectionMatrix();',
  '    renderer.setSize(viewport.width, viewport.height, false);',
  '    largeGraphDirty = true;',
  '    graphDirty = true;',
  '  };',
].join('\n');
scene = replaceOnce(scene, oldResize, newResize, 'resize ownership');
writeFileSync(scenePath, scene);

const helper = `export interface ScreenViewport {\n  width: number;\n  height: number;\n}\n\nexport interface ProjectedScreenPoint {\n  x: number;\n  y: number;\n}\n\nexport interface NodeScreenGeometry {\n  centerX: number;\n  centerY: number;\n  radiusPx: number;\n  topX: number;\n  topY: number;\n}\n\nfunction ndcToScreen(point: ProjectedScreenPoint, viewport: ScreenViewport) {\n  const width = Math.max(viewport.width, 1);\n  const height = Math.max(viewport.height, 1);\n  return {\n    x: (point.x * .5 + .5) * width,\n    y: (-point.y * .5 + .5) * height,\n  };\n}\n\n/**\n * Converts a rendered sphere center and one radius sample into the only geometry\n * the DOM label layer is allowed to consume. The sample measures radius only;\n * label direction is a screen-space invariant: straight up from the visible center.\n */\nexport function nodeScreenGeometryFromNdc(\n  centerNdc: ProjectedScreenPoint,\n  radiusSampleNdc: ProjectedScreenPoint,\n  viewport: ScreenViewport,\n): NodeScreenGeometry {\n  const center = ndcToScreen(centerNdc, viewport);\n  const sample = ndcToScreen(radiusSampleNdc, viewport);\n  const radiusPx = Math.hypot(sample.x - center.x, sample.y - center.y);\n  return {\n    centerX: center.x,\n    centerY: center.y,\n    radiusPx,\n    topX: center.x,\n    topY: center.y - radiusPx,\n  };\n}\n`;
writeFileSync(helperPath, helper);

let test = readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
  "} from './StableShellLabelBudget';",
  "} from './StableShellLabelBudget';\nimport { nodeScreenGeometryFromNdc } from './NodeScreenGeometry';",
  'screen geometry test import',
);
const finiteAnchor = [
  'assert(hasFiniteCoordinates({x:0,y:-1,z:2}));',
  'assert(!hasFiniteCoordinates({x:Number.NaN,y:0,z:0}));',
  'assert(!hasFiniteCoordinates({x:0,y:Number.POSITIVE_INFINITY,z:0}));',
].join('\n');
const finiteWithScreenGeometry = finiteAnchor + `\n\nconst portraitScreenGeometry = nodeScreenGeometryFromNdc(\n  { x: 0, y: 0 },\n  { x: 0, y: .2 },\n  { width: 390, height: 844 },\n);\nassert(Math.abs(portraitScreenGeometry.centerX - 195) < 1e-9);\nassert(Math.abs(portraitScreenGeometry.centerY - 422) < 1e-9);\nassert(Math.abs(portraitScreenGeometry.radiusPx - 84.4) < 1e-9);\nassert(Math.abs(portraitScreenGeometry.topY - (portraitScreenGeometry.centerY - portraitScreenGeometry.radiusPx)) < 1e-9, 'label anchor must be centerY - radiusPx');\nconst doubledScreenGeometry = nodeScreenGeometryFromNdc(\n  { x: 0, y: 0 },\n  { x: 0, y: .2 },\n  { width: 780, height: 1688 },\n);\nassert(Math.abs(doubledScreenGeometry.radiusPx - portraitScreenGeometry.radiusPx * 2) < 1e-9, 'radius must scale with the canvas CSS viewport');\nassert(Math.abs(doubledScreenGeometry.topY - portraitScreenGeometry.topY * 2) < 1e-9, 'sphere-top anchor must scale with the same canvas viewport');\nconst driftedRadiusSample = nodeScreenGeometryFromNdc(\n  { x: .1, y: -.1 },\n  { x: .12, y: .1 },\n  { width: 412, height: 915 },\n);\nassert.equal(driftedRadiusSample.topX, driftedRadiusSample.centerX, 'label direction must stay vertically above the rendered center');\nassert(driftedRadiusSample.topY < driftedRadiusSample.centerY, 'screen-space sphere top must always subtract radiusPx');`;
test = replaceOnce(test, finiteAnchor, finiteWithScreenGeometry, 'screen geometry unit tests');

const oldLabelAssertions = [
  "assert(labelsSource.includes('record.shell.getWorldScale(shellWorldScale)'), 'label anchor must read the sphere current rendered size');",
  "assert(labelsSource.includes('labelAnchorWorld.copy(worldPos).addScaledVector(cameraUp, renderedSphereRadius)'), 'label anchor must sit on the camera-up edge of the rendered sphere');",
  "assert(labelsSource.includes('labelAnchorProjected.copy(labelAnchorWorld).project(camera)'), 'sphere-top anchor must be projected through the current camera');",
  "assert(labelsSource.includes('y: (-labelAnchorProjected.y * .5 + .5) * host.clientHeight,'), 'label top must be the direct projected sphere-top coordinate');",
  "assert(!sceneSource.includes('LABEL_SPHERE_GAP_PX'), 'scene must not keep a second pixel-gap authority');",
].join('\n');
const newLabelAssertions = [
  "assert(labelsSource.includes('record.shell.getWorldScale(shellWorldScale)'), 'screen radius measurement must read the sphere current rendered size');",
  "assert(labelsSource.includes('radiusSampleWorld.copy(worldPos).addScaledVector(cameraUp, renderedSphereRadius)'), '3D camera-up sample may measure radius but must not own final label placement');",
  "assert(labelsSource.includes('const screenGeometry = nodeScreenGeometryFromNdc('), 'labels must cross the explicit 3D-to-screen geometry boundary');",
  "assert(labelsSource.includes('x: screenGeometry.topX,'), 'label x must come only from screen geometry');",
  "assert(labelsSource.includes('y: screenGeometry.topY,'), 'label y must come only from centerY - radiusPx screen geometry');",
  "assert(!labelsSource.includes('host.clientWidth'), 'label placement must not mix host dimensions with the canvas viewport');",
  "assert(!labelsSource.includes('host.clientHeight'), 'label placement must not mix host dimensions with the canvas viewport');",
  "assert(!sceneSource.includes('LABEL_SPHERE_GAP_PX'), 'scene must not keep a second pixel-gap authority');",
].join('\n');
test = replaceOnce(test, oldLabelAssertions, newLabelAssertions, 'label architecture assertions');
const resizeAssertion = "assert(sceneSource.includes('if (mobilePerformance && isTextEntryElement(document.activeElement)) return;'), 'mobile text entry must suppress keyboard-driven scene resize');";
const resizeAssertions = resizeAssertion + `\nconst resizeStart = sceneSource.indexOf('const resize =');\nconst scheduleFrameStart = sceneSource.indexOf('const scheduleFrame =', resizeStart);\nassert(resizeStart >= 0 && scheduleFrameStart > resizeStart, 'resize block must remain discoverable');\nconst resizeSource = sceneSource.slice(resizeStart, scheduleFrameStart);\nassert(resizeSource.indexOf("setProperty('--app-height'") < resizeSource.indexOf('const viewport = canvasViewport();'), 'layout height must settle before measuring the canvas viewport');\nassert(resizeSource.includes('camera.aspect = viewport.width / viewport.height;'), 'camera aspect must use the canvas viewport');\nassert(resizeSource.includes('renderer.setSize(viewport.width, viewport.height, false);'), 'renderer drawing buffer must follow the canvas CSS viewport without creating another CSS size authority');`;
test = replaceOnce(test, resizeAssertion, resizeAssertions, 'resize regression assertions');
writeFileSync(testPath, test);

console.log('Applied screen-space label geometry refactor');
