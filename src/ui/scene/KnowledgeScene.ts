import * as THREE from 'three';
import type { KnowledgeLayer } from '../../domain/KnowledgeLayerPolicy';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import {
  CORE_AMBIENT_LIGHT_INTENSITY,
  CORE_LABEL_REVEAL_ZOOM,
  CORE_SUN_COLOR,
  CORE_SUN_GLOW_SCALE,
  CORE_SUN_LIGHT_DECAY,
  CORE_SUN_LIGHT_DISTANCE,
  CORE_SUN_LIGHT_INTENSITY,
  CORE_SUN_RADIUS,
  CORE_SUN_SHADOW_FAR,
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
  SUN_ANGULAR_SPEED,
  SUN_ORBIT_RADIUS,
  SUN_RADIUS_MM,
  SUN_TRIAD_IDS,
  TYPE_COLOR,
} from '../config/KnowledgeUiConfig';
import {
  MOBILE_ACTIVE_NODE_TARGET,
  selectMobileActiveNodeIds,
  type MobileSceneCandidate,
} from './MobileSceneLod';

export interface KnowledgeSceneNode {
  id: string;
  title: string;
  type: keyof typeof TYPE_COLOR;
  status: 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
  mastery: 'none' | 'touched' | 'mastered';
  reasoning: string;
  premises: string[];
  logicRuleId?: string;
  aliases?: string[];
  semanticKey?: string;
  twinGroup?: string;
  sharedTitle?: string;
  declaredLayer?: KnowledgeLayer;
  effectiveLayer?: KnowledgeLayer;
  pos?: THREE.Vector3;
  vel?: THREE.Vector3;
  homePos?: THREE.Vector3;
  layer?: KnowledgeLayer;
}

export interface KnowledgeSceneCallbacks {
  onNodeTap: (id: string) => void;
  onBackgroundTap: () => void;
  onBackgroundDoubleTap: () => void;
}

export interface KnowledgeSceneOptions {
  host: HTMLElement;
  labelsLayer: HTMLElement;
  getNodes: () => KnowledgeSceneNode[];
  callbacks: KnowledgeSceneCallbacks;
}

export interface KnowledgeSceneRuntime {
  markDirty: () => void;
  start: () => void;
  stop: () => void;
  setOverlayVisible: (visible: boolean) => void;
  resize: () => void;
  setLabelBrightness: (n: number) => void;
  setNodeRadius: (n: number) => void;
  setHideUntouched: (enabled: boolean) => void;
  setCascadeDepthLimit: (n: number | null) => void;
  getCameraZ: () => number;
  getVisibleEdgeCount: () => number;
  getActiveNodeCount: () => number;
  screenPositionForNode: (id: string) => { x: number; y: number } | null;
}

type NodeShellMaterial = THREE.MeshMatcapMaterial | THREE.MeshPhongMaterial;
type NodeMeshRecord = {
  group: THREE.Group;
  shell: THREE.Mesh<THREE.SphereGeometry, NodeShellMaterial>;
  point: THREE.Sprite;
  dot: THREE.Sprite;
  baseShellOpacity: number;
  basePointOpacity: number;
  baseDotOpacity: number;
};
type Layer = NonNullable<KnowledgeSceneNode['layer']>;

export function isCoreNodeId(id: string): boolean {
  return isSystemCoreNodeId(id);
}

export function layerForNode(node: Pick<KnowledgeSceneNode, 'id' | 'status' | 'type' | 'effectiveLayer'>): Layer {
  if (node.effectiveLayer) return node.effectiveLayer;
  if (isCoreNodeId(node.id)) return 'core';
  if (['pending', 'suspended', 'disputed'].includes(node.status)) return 'outer';
  if (['hypothesis', 'prediction', 'opinion', 'value'].includes(node.type)) return 'outer';
  if (node.type === 'definition' || node.type === 'fact') return 'inner';
  return 'middle';
}

export function colorForNode(node: Pick<KnowledgeSceneNode, 'id' | 'status' | 'type' | 'effectiveLayer'>): number {
  if (node.status === 'falsified') return NODE_SPECIAL_COLOR.falsified;
  if (node.type === 'reasoning' || node.type === 'logic-symbol') return NODE_SPECIAL_COLOR.structural;
  return NODE_LAYER_COLOR[layerForNode(node)];
}

function hash01(input: string, salt: number) {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smoothStep01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function pendingPulseAtCycleMs(cycleMs: number): { opacityFactor: number; scale: number } {
  const t = ((cycleMs % PENDING_PULSE_PERIOD_MS) + PENDING_PULSE_PERIOD_MS) % PENDING_PULSE_PERIOD_MS;
  const fadeStart = PENDING_PULSE_VISIBLE_MS;
  const lowStart = fadeStart + PENDING_PULSE_FADE_MS;
  const riseStart = lowStart + PENDING_PULSE_LOW_MS;
  if (t < fadeStart) return { opacityFactor: 1, scale: 1 };
  if (t < lowStart) {
    const p = smoothStep01((t - fadeStart) / PENDING_PULSE_FADE_MS);
    return {
      opacityFactor: THREE.MathUtils.lerp(1, PENDING_PULSE_MIN_OPACITY, p),
      scale: THREE.MathUtils.lerp(1, PENDING_PULSE_MIN_SCALE, p),
    };
  }
  if (t < riseStart) return { opacityFactor: PENDING_PULSE_MIN_OPACITY, scale: PENDING_PULSE_MIN_SCALE };
  const p = smoothStep01((t - riseStart) / PENDING_PULSE_RISE_MS);
  return {
    opacityFactor: THREE.MathUtils.lerp(PENDING_PULSE_MIN_OPACITY, 1, p),
    scale: THREE.MathUtils.lerp(PENDING_PULSE_MIN_SCALE, 1, p),
  };
}

export function pendingPulsePhaseMs(nodeId: string): number {
  return hash01(nodeId, 83) * PENDING_PULSE_PERIOD_MS;
}

export function pendingPulseState(nodeId: string, timeMs: number) {
  return pendingPulseAtCycleMs(timeMs + pendingPulsePhaseMs(nodeId));
}

export function initialNodePosition(node: Pick<KnowledgeSceneNode, 'id' | 'status' | 'type' | 'effectiveLayer'>): THREE.Vector3 {
  const layer = layerForNode(node);
  if (layer === 'core') {
    const i = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as (typeof SUN_TRIAD_IDS)[number]));
    const a = i * Math.PI * 2 / SUN_TRIAD_IDS.length;
    return new THREE.Vector3(Math.cos(a) * SUN_ORBIT_RADIUS, Math.sin(a) * SUN_ORBIT_RADIUS, 0);
  }
  const b = LAYER_BANDS[layer];
  const u = hash01(node.id, 11);
  const v = hash01(node.id, 29);
  const w = hash01(node.id, 47);
  const z = 1 - 2 * u;
  const phi = Math.PI * 2 * v;
  const xy = Math.sqrt(Math.max(0, 1 - z * z));
  const r = Math.cbrt(b.rMin ** 3 + w * (b.rMax ** 3 - b.rMin ** 3));
  return new THREE.Vector3(r * xy * Math.cos(phi), r * xy * Math.sin(phi), r * z);
}

export function shouldRenderEdge(fromId: string, toId: string) {
  return !isCoreNodeId(fromId) && !isCoreNodeId(toId);
}

export function nodeVisibleInPersonalMode(node: Pick<KnowledgeSceneNode, 'id' | 'mastery'>, hideUntouched: boolean): boolean {
  return isCoreNodeId(node.id) || !hideUntouched || node.mastery !== 'none';
}

export function clampGraphZoom(z: number) {
  return THREE.MathUtils.clamp(z, MIN_GRAPH_ZOOM, MAX_GRAPH_ZOOM);
}

export function ordinaryNodeCompensationScale(graphZoom: number) {
  return 1 / clampGraphZoom(graphZoom);
}

export function nodeRadiusForType(type: KnowledgeSceneNode['type'], conclusionRadius: number) {
  return type === 'reasoning' ? conclusionRadius / 3 : conclusionRadius;
}

export function coreLabelsVisible(graphZoom: number) {
  return graphZoom >= CORE_LABEL_REVEAL_ZOOM;
}

export function coreSunContainsTriad() {
  return CORE_SUN_RADIUS > SUN_ORBIT_RADIUS + SUN_RADIUS_MM;
}

export function coreOrbitScreenPosition(index: number, angle: number) {
  const a = angle + index * Math.PI * 2 / SUN_TRIAD_IDS.length;
  return new THREE.Vector3(Math.cos(a) * SUN_ORBIT_RADIUS, Math.sin(a) * SUN_ORBIT_RADIUS, 0);
}

export function hasFiniteCoordinates(vector: Pick<THREE.Vector3, 'x' | 'y' | 'z'> | undefined): boolean {
  return Boolean(vector && [vector.x, vector.y, vector.z].every(Number.isFinite));
}

export function createCoreSunLight() {
  const light = new THREE.PointLight(CORE_SUN_COLOR, CORE_SUN_LIGHT_INTENSITY, CORE_SUN_LIGHT_DISTANCE, CORE_SUN_LIGHT_DECAY);
  light.position.set(0, 0, 0);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = .5;
  light.shadow.camera.far = CORE_SUN_SHADOW_FAR;
  light.shadow.camera.updateProjectionMatrix();
  return light;
}

export function createKnowledgeScene({ host, labelsLayer, getNodes, callbacks }: KnowledgeSceneOptions): KnowledgeSceneRuntime {
  let running = false;
  let overlayVisible = false;
  let largeGraphDirty = true;
  let rafId = 0;
  let frameTimer: number | null = null;
  let labelBrightness = 1;
  let nodeRadiusMM = 7.2;
  let hideUntouched = false;
  let selectedId: string | null = null;
  let draggedNodeId: string | null = null;
  let graphZoom = 1.27;
  let lastFrameAt = 0;
  let mobileActiveNodeIds = new Set<string>();
  const mobilePerformance = window.matchMedia('(max-width: 640px)').matches;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / Math.max(host.clientHeight, 1), .5, 8000);
  camera.position.set(0, 0, DEFAULT_CAM_Z);
  const renderer = new THREE.WebGLRenderer({ antialias: KNOWLEDGE_SCENE_THEME.renderer.antialias, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobilePerformance ? KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio : KNOWLEDGE_SCENE_THEME.renderer.desktopPixelRatio));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = !mobilePerformance;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.touchAction = 'none';
  host.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  const edgesGroup = new THREE.Group();
  const nodesGroup = new THREE.Group();
  scene.add(worldGroup);
  worldGroup.add(edgesGroup, nodesGroup);
  scene.add(new THREE.AmbientLight(0xffffff, CORE_AMBIENT_LIGHT_INTENSITY));

  const glow = (strong: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, KNOWLEDGE_SCENE_THEME.mastery.coreStop);
    g.addColorStop(strong ? .46 : .34, strong ? KNOWLEDGE_SCENE_THEME.mastery.masteredMidStop : KNOWLEDGE_SCENE_THEME.mastery.touchedMidStop);
    g.addColorStop(1, KNOWLEDGE_SCENE_THEME.mastery.edgeStop);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  };

  const nodeMatcap = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const gray = (value: number) => `rgb(${value},${value},${value})`;
    const g = x.createRadialGradient(39, 32, 2, 61, 61, 92);
    g.addColorStop(0, gray(KNOWLEDGE_SCENE_THEME.node.matcapLight));
    g.addColorStop(.48, gray(KNOWLEDGE_SCENE_THEME.node.matcapMid));
    g.addColorStop(1, gray(KNOWLEDGE_SCENE_THEME.node.matcapDark));
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(c);
    texture.needsUpdate = true;
    return texture;
  };

  const strongTex = glow(true);
  const fluorTex = glow(false);
  const nodeMatcapTex = nodeMatcap();
  const ordinarySphereGeometry = new THREE.SphereGeometry(1, KNOWLEDGE_SCENE_THEME.node.sphereWidthSegments, KNOWLEDGE_SCENE_THEME.node.sphereHeightSegments);

  const coreSunGroup = new THREE.Group();
  coreSunGroup.position.set(0, 0, 0);
  worldGroup.add(coreSunGroup);
  const coreSun = new THREE.Mesh(
    new THREE.SphereGeometry(CORE_SUN_RADIUS, 32, 20),
    new THREE.MeshPhongMaterial({
      color: CORE_SUN_COLOR,
      emissive: CORE_SUN_COLOR,
      emissiveIntensity: .82,
      transparent: true,
      opacity: KNOWLEDGE_SCENE_THEME.sun.coreOpacity,
      depthTest: true,
      depthWrite: false,
    }),
  );
  coreSun.renderOrder = 12;
  coreSunGroup.add(coreSun);
  const coreSunInnerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: strongTex, color: KNOWLEDGE_SCENE_THEME.sun.core, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.sun.innerGlowOpacity, depthTest: true, depthWrite: false }));
  coreSunInnerGlow.scale.setScalar(CORE_SUN_RADIUS * 2 * KNOWLEDGE_SCENE_THEME.sun.innerGlowScale);
  coreSunInnerGlow.renderOrder = 11;
  coreSunGroup.add(coreSunInnerGlow);
  const coreSunCorona = new THREE.Sprite(new THREE.SpriteMaterial({ map: strongTex, color: KNOWLEDGE_SCENE_THEME.sun.corona, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.sun.coronaOpacity, depthTest: true, depthWrite: false }));
  coreSunCorona.scale.setScalar(CORE_SUN_RADIUS * 2 * CORE_SUN_GLOW_SCALE);
  coreSunCorona.renderOrder = 10;
  coreSunGroup.add(coreSunCorona);
  const coreSunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: strongTex, color: KNOWLEDGE_SCENE_THEME.sun.halo, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.sun.haloOpacity, depthTest: true, depthWrite: false }));
  coreSunHalo.scale.setScalar(CORE_SUN_RADIUS * 2 * KNOWLEDGE_SCENE_THEME.sun.haloScale);
  coreSunHalo.renderOrder = 9;
  coreSunGroup.add(coreSunHalo);
  const coreLight = createCoreSunLight();
  coreLight.castShadow = !mobilePerformance;
  coreSunGroup.add(coreLight);

  const nodeMap: Record<string, NodeMeshRecord> = {};
  const edgeMap: Record<string, THREE.Line> = {};
  const labelMap: Record<string, HTMLDivElement> = {};
  const pendingNodeIds = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'rotate' | 'node' | 'pinch' | null = null;
  let pinchOccurred = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let lastBgTapTime = 0;
  let bgTapTimer: number | null = null;
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const worldPos = new THREE.Vector3();
  const projectedPos = new THREE.Vector3();
  let lastEdgeSync = 0;

  const place = (n: KnowledgeSceneNode) => {
    n.layer = layerForNode(n);
    n.pos = initialNodePosition(n);
    n.vel = new THREE.Vector3();
    n.homePos = n.pos.clone();
  };

  const colorFor = (n: KnowledgeSceneNode) => colorForNode(n);
  const masteryOpacity = (n: KnowledgeSceneNode) => n.mastery === 'mastered'
    ? KNOWLEDGE_SCENE_THEME.mastery.masteredOpacity
    : n.mastery === 'touched'
      ? KNOWLEDGE_SCENE_THEME.mastery.touchedOpacity
      : KNOWLEDGE_SCENE_THEME.mastery.noneOpacity;

  const ensure = (n: KnowledgeSceneNode) => {
    if (nodeMap[n.id]) return nodeMap[n.id];
    const core = isCoreNodeId(n.id);
    const color = colorFor(n);
    const group = new THREE.Group();
    group.userData.nodeId = n.id;
    const shellMaterial: NodeShellMaterial = core
      ? new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: .34, shininess: 42, wireframe: false, transparent: true, opacity: .84, depthTest: false, depthWrite: false })
      : new THREE.MeshMatcapMaterial({ color, matcap: nodeMatcapTex, wireframe: false, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.node.shellOpacity, depthTest: true, depthWrite: true });
    const shell = new THREE.Mesh(core ? new THREE.SphereGeometry(1, 24, 12) : ordinarySphereGeometry, shellMaterial);
    shell.renderOrder = core ? 20 : 0;
    shell.castShadow = !core && !mobilePerformance;
    shell.receiveShadow = !core && !mobilePerformance;
    const pointMaterial = new THREE.SpriteMaterial({ map: fluorTex, color, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.node.pointOpacity, depthTest: !core, depthWrite: false });
    const point = new THREE.Sprite(pointMaterial);
    point.renderOrder = core ? 21 : 1;
    const dotMaterial = new THREE.SpriteMaterial({ map: n.mastery === 'mastered' ? strongTex : fluorTex, color: KNOWLEDGE_SCENE_THEME.mastery.tint, transparent: true, opacity: masteryOpacity(n), depthTest: !core, depthWrite: false });
    const dot = new THREE.Sprite(dotMaterial);
    dot.renderOrder = core ? 22 : 2;
    group.add(shell, point, dot);
    nodesGroup.add(group);
    const label = document.createElement('div');
    label.className = 'node-label';
    label.textContent = n.title;
    labelsLayer.appendChild(label);
    labelMap[n.id] = label;
    return nodeMap[n.id] = {
      group,
      shell,
      point,
      dot,
      baseShellOpacity: shellMaterial.opacity,
      basePointOpacity: pointMaterial.opacity,
      baseDotOpacity: dotMaterial.opacity,
    };
  };

  const removeNodeRecord = (id: string) => {
    const record = nodeMap[id];
    if (!record) return;
    nodesGroup.remove(record.group);
    record.shell.material.dispose();
    (record.point.material as THREE.Material).dispose();
    (record.dot.material as THREE.Material).dispose();
    if (isCoreNodeId(id)) record.shell.geometry.dispose();
    labelMap[id]?.remove();
    delete nodeMap[id];
    delete labelMap[id];
  };

  const selectedRelationIds = (nodes: readonly KnowledgeSceneNode[]) => {
    const forced = new Set<string>();
    for (const node of nodes) if (isCoreNodeId(node.id)) forced.add(node.id);
    if (!selectedId) return forced;
    const byId = new Map(nodes.map(node => [node.id, node] as const));
    const selected = byId.get(selectedId);
    if (!selected) return forced;
    forced.add(selected.id);
    for (const id of selected.premises) forced.add(id);
    if (selected.logicRuleId) forced.add(selected.logicRuleId);
    for (const node of nodes) {
      if (node.premises.includes(selected.id) || node.logicRuleId === selected.id) forced.add(node.id);
      if (selected.twinGroup && node.twinGroup === selected.twinGroup) forced.add(node.id);
    }
    return forced;
  };

  const mobileCandidates = (nodes: readonly KnowledgeSceneNode[]): MobileSceneCandidate[] => {
    worldGroup.updateMatrixWorld(true);
    return nodes.map(node => {
      worldPos.copy(node.pos!).applyMatrix4(worldGroup.matrixWorld);
      projectedPos.copy(worldPos).project(camera);
      const inView = projectedPos.z > -1 && projectedPos.z < 1 && Math.abs(projectedPos.x) <= 1.08 && Math.abs(projectedPos.y) <= 1.08;
      const centerPenalty = projectedPos.x * projectedPos.x + projectedPos.y * projectedPos.y;
      return {
        id: node.id,
        score: (inView ? 1_000_000 : 0) + worldPos.z * 1_000 - centerPenalty * 100,
      };
    });
  };

  const activeNodesForRender = (nodes: KnowledgeSceneNode[]) => {
    const eligible = nodes.filter(node => nodeVisibleInPersonalMode(node, hideUntouched));
    if (!mobilePerformance || eligible.length <= MOBILE_ACTIVE_NODE_TARGET) {
      mobileActiveNodeIds = new Set(eligible.map(node => node.id));
      return eligible;
    }
    const forced = selectedRelationIds(eligible);
    mobileActiveNodeIds = selectMobileActiveNodeIds(mobileCandidates(eligible), mobileActiveNodeIds, forced);
    return eligible.filter(node => mobileActiveNodeIds.has(node.id));
  };

  const updateLine = (line: THREE.Line, a?: THREE.Vector3, b?: THREE.Vector3) => {
    if (!hasFiniteCoordinates(a) || !hasFiniteCoordinates(b)) {
      line.userData.geometryVisible = false;
      line.visible = false;
      return;
    }
    line.geometry.setFromPoints([a!.clone(), b!.clone()]);
    line.userData.geometryVisible = true;
    line.visible = true;
    if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
  };

  const syncEdges = (nodes: KnowledgeSceneNode[]) => {
    const ids = new Set(nodes.map(n => n.id));
    const wanted = new Set<string>();
    const hasSelection = selectedId !== null;
    nodes.forEach(n => [...n.premises, ...(n.logicRuleId ? [n.logicRuleId] : [])].forEach(p => {
      if (!ids.has(p) || !shouldRenderEdge(p, n.id)) return;
      const key = `${p}->${n.id}`;
      const logic = n.logicRuleId === p;
      wanted.add(key);
      if (!edgeMap[key]) {
        edgeMap[key] = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: logic ? KNOWLEDGE_SCENE_THEME.edge.logic : KNOWLEDGE_SCENE_THEME.edge.normal, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.edge.normalOpacity }));
        edgesGroup.add(edgeMap[key]);
      }
      edgeMap[key].userData.edgeEndpoints = [p, n.id];
      const material = edgeMap[key].material as THREE.LineBasicMaterial;
      material.color.setHex(logic ? KNOWLEDGE_SCENE_THEME.edge.logic : KNOWLEDGE_SCENE_THEME.edge.normal);
      const relationActive = hasSelection && (selectedId === p || selectedId === n.id || n.premises.includes(selectedId!));
      const stateOpacity = n.status === 'falsified'
        ? KNOWLEDGE_SCENE_THEME.edge.falsifiedOpacity
        : n.status === 'suspended'
          ? KNOWLEDGE_SCENE_THEME.edge.suspendedOpacity
          : n.status === 'disputed'
            ? KNOWLEDGE_SCENE_THEME.edge.disputedOpacity
            : KNOWLEDGE_SCENE_THEME.edge.normalOpacity;
      material.opacity = relationActive ? KNOWLEDGE_SCENE_THEME.edge.activeOpacity : stateOpacity * (hasSelection ? KNOWLEDGE_SCENE_THEME.edge.inactiveFactor : 1);
      updateLine(edgeMap[key], nodeMap[p]?.group.position, nodeMap[n.id]?.group.position);
    }));

    nodes.filter(n => n.twinGroup && !isCoreNodeId(n.id)).forEach(n => {
      const twin = nodes.find(other => other.id !== n.id && other.twinGroup === n.twinGroup && shouldRenderEdge(n.id, other.id));
      if (!twin) return;
      const key = [n.id, twin.id].sort().join('<->');
      wanted.add(key);
      if (!edgeMap[key]) {
        edgeMap[key] = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: KNOWLEDGE_SCENE_THEME.edge.twin, transparent: true, opacity: KNOWLEDGE_SCENE_THEME.edge.twinOpacity, dashSize: 4, gapSize: 3 }));
        edgesGroup.add(edgeMap[key]);
      }
      edgeMap[key].userData.edgeEndpoints = [n.id, twin.id];
      const material = edgeMap[key].material as THREE.LineDashedMaterial;
      material.color.setHex(KNOWLEDGE_SCENE_THEME.edge.twin);
      material.opacity = KNOWLEDGE_SCENE_THEME.edge.twinOpacity;
      updateLine(edgeMap[key], nodeMap[n.id]?.group.position, nodeMap[twin.id]?.group.position);
    });

    Object.keys(edgeMap).forEach(key => {
      if (wanted.has(key)) return;
      edgesGroup.remove(edgeMap[key]);
      edgeMap[key].geometry.dispose();
      (edgeMap[key].material as THREE.Material).dispose();
      delete edgeMap[key];
    });
  };

  const applyVisibility = () => {
    const byId = new Map(getNodes().map(node => [node.id, node] as const));
    const visibleIds = new Set<string>();
    for (const [id, record] of Object.entries(nodeMap)) {
      const node = byId.get(id);
      const visible = Boolean(node && nodeVisibleInPersonalMode(node, hideUntouched));
      if (visible) visibleIds.add(id);
      record.group.visible = visible;
      if (labelMap[id]) labelMap[id].style.display = visible ? '' : 'none';
    }
    Object.values(edgeMap).forEach(edge => {
      const endpoints = edge.userData.edgeEndpoints as [string, string] | undefined;
      if (!endpoints) return;
      edge.visible = edge.userData.geometryVisible === true && visibleIds.has(endpoints[0]) && visibleIds.has(endpoints[1]);
    });
  };

  const sync = () => {
    worldGroup.scale.setScalar(graphZoom);
    const allNodes = getNodes();
    allNodes.forEach(node => { if (!hasFiniteCoordinates(node.pos)) place(node); });
    const activeNodes = activeNodesForRender(allNodes);
    const activeIds = new Set(activeNodes.map(node => node.id));
    pendingNodeIds.clear();
    Object.keys(nodeMap).forEach(id => { if (!activeIds.has(id)) removeNodeRecord(id); });

    activeNodes.forEach(n => {
      const record = ensure(n);
      record.group.position.copy(n.pos!);
      record.group.scale.setScalar(1);
      const core = isCoreNodeId(n.id);
      const pending = !core && n.status === 'pending';
      const radius = core ? SUN_RADIUS_MM : nodeRadiusForType(n.type, nodeRadiusMM);
      const color = colorFor(n);
      const compensation = core ? 1 : ordinaryNodeCompensationScale(graphZoom);
      if (pending) pendingNodeIds.add(n.id);
      record.shell.visible = true;
      record.point.visible = !core;
      record.shell.scale.setScalar(radius * compensation);
      record.point.scale.setScalar(radius * 2.4 * compensation);
      record.dot.scale.setScalar((n.mastery === 'mastered' ? radius * 3.6 : n.mastery === 'touched' ? radius * 2.65 : radius * 1.5) * compensation);
      const pointMaterial = record.point.material as THREE.SpriteMaterial;
      pointMaterial.color.setHex(color);
      record.basePointOpacity = KNOWLEDGE_SCENE_THEME.node.pointOpacity;
      pointMaterial.opacity = record.basePointOpacity;
      const dotMaterial = record.dot.material as THREE.SpriteMaterial;
      dotMaterial.map = n.mastery === 'mastered' ? strongTex : fluorTex;
      dotMaterial.color.setHex(KNOWLEDGE_SCENE_THEME.mastery.tint);
      record.baseDotOpacity = masteryOpacity(n);
      dotMaterial.opacity = record.baseDotOpacity;
      const material = record.shell.material;
      material.color.setHex(color);
      record.baseShellOpacity = core ? .84 : KNOWLEDGE_SCENE_THEME.node.shellOpacity;
      material.opacity = record.baseShellOpacity;
      if (material instanceof THREE.MeshPhongMaterial) {
        material.emissive.setHex(color);
        material.emissiveIntensity = .34;
      }
    });

    edgesGroup.visible = true;
    const largeMobileGraph = mobilePerformance && allNodes.length > MOBILE_ACTIVE_NODE_TARGET;
    const now = performance.now();
    if (largeMobileGraph || now - lastEdgeSync >= 100) {
      syncEdges(activeNodes);
      lastEdgeSync = now;
    }
    applyVisibility();
  };

  const applyPendingPulse = (time: number) => {
    pendingNodeIds.forEach(id => {
      const record = nodeMap[id];
      if (!record || !record.group.visible) return;
      const pulse = pendingPulseState(id, time);
      record.group.scale.setScalar(pulse.scale);
      record.shell.material.opacity = record.baseShellOpacity * pulse.opacityFactor;
      (record.point.material as THREE.SpriteMaterial).opacity = record.basePointOpacity * pulse.opacityFactor;
      (record.dot.material as THREE.SpriteMaterial).opacity = record.baseDotOpacity * pulse.opacityFactor;
    });
  };

  const physics = (_dt: number) => {
    const nodes = getNodes();
    const inverseWorldRotation = worldGroup.quaternion.clone().invert();
    nodes.forEach(n => {
      if (!hasFiniteCoordinates(n.pos)) place(n);
      if (draggedNodeId === n.id) return;
      if (isCoreNodeId(n.id)) {
        const i = SUN_TRIAD_IDS.indexOf(n.id as (typeof SUN_TRIAD_IDS)[number]);
        const screenOrbit = coreOrbitScreenPosition(i, clock.elapsedTime * SUN_ANGULAR_SPEED);
        n.pos!.copy(screenOrbit.applyQuaternion(inverseWorldRotation));
        return;
      }
      n.homePos ??= n.pos!.clone();
      n.pos!.copy(n.homePos!);
      n.vel ??= new THREE.Vector3();
      n.vel.set(0, 0, 0);
    });
  };

  const labels = () => {
    scene.updateMatrixWorld(true);
    const allNodes = getNodes();
    const largeMobileGraph = mobilePerformance && allNodes.length > MOBILE_ACTIVE_NODE_TARGET;
    const activeNodes = allNodes.filter(node => Boolean(nodeMap[node.id]));
    activeNodes.forEach((n, index) => {
      const label = labelMap[n.id];
      const record = nodeMap[n.id];
      if (!label || !record) return;
      record.group.getWorldPosition(worldPos);
      const projected = worldPos.clone().project(camera);
      const visible = record.group.visible
        && (!largeMobileGraph || index % 4 === 0 || selectedId === n.id)
        && projected.z > -1
        && projected.z < 1
        && (!isCoreNodeId(n.id) || coreLabelsVisible(graphZoom));
      label.style.display = visible ? '' : 'none';
      if (!visible) return;
      const x = (projected.x * .5 + .5) * host.clientWidth;
      const y = (-projected.y * .5 + .5) * host.clientHeight;
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      label.style.transform = 'translate(-50%, 10px)';
      label.style.opacity = String(labelBrightness);
      label.classList.toggle('selected', selectedId === n.id);
    });
  };

  const pick = (x: number, y: number) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const shells = Object.values(nodeMap).filter(record => record.group.visible).map(record => record.shell);
    if (mobilePerformance) {
      let nearest: { id: string; distance: number } | null = null;
      for (const shell of shells) {
        shell.parent!.getWorldPosition(worldPos);
        const projected = worldPos.clone().project(camera);
        if (!hasFiniteCoordinates(projected)) continue;
        const sx = rect.left + (projected.x * .5 + .5) * rect.width;
        const sy = rect.top + (-projected.y * .5 + .5) * rect.height;
        const distance = Math.hypot(sx - x, sy - y);
        const id = shell.parent?.userData.nodeId;
        if (typeof id === 'string' && distance <= 24 && (!nearest || distance < nearest.distance)) nearest = { id, distance };
      }
      return nearest?.id ?? null;
    }
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(shells, false)[0]?.object.parent?.userData.nodeId;
    return typeof hit === 'string' ? hit : null;
  };

  const down = (e: PointerEvent) => {
    if (overlayVisible) return;
    if (e.pointerType === 'mouse') renderer.domElement.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartZoom = graphZoom;
      pinchOccurred = true;
      mode = 'pinch';
      return;
    }
    draggedNodeId = pick(e.clientX, e.clientY);
    mode = draggedNodeId ? 'node' : 'rotate';
  };

  const move = (e: PointerEvent) => {
    if (overlayVisible || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
      graphZoom = clampGraphZoom(pinchStartZoom * dist / pinchStartDist);
      largeGraphDirty = true;
    } else if (mode === 'rotate') {
      worldGroup.rotation.y += (e.clientX - lastX) * .004;
      worldGroup.rotation.x += (e.clientY - lastY) * .004;
      largeGraphDirty = true;
    } else if (mode === 'node' && draggedNodeId) {
      const node = getNodes().find(value => value.id === draggedNodeId);
      if (node?.pos) {
        const delta = new THREE.Vector3((e.clientX - lastX) * .45 / graphZoom, -(e.clientY - lastY) * .45 / graphZoom, 0).applyQuaternion(worldGroup.quaternion.clone().invert());
        node.pos.add(delta);
        largeGraphDirty = true;
      }
    }
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const up = (e: PointerEvent) => {
    if (overlayVisible) return;
    performance.mark?.('knowledge-node-tap-start');
    pointers.delete(e.pointerId);
    if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
    const nodeId = !moved && !pinchOccurred ? draggedNodeId : null;
    if (nodeId) {
      selectedId = nodeId;
      largeGraphDirty = true;
      window.setTimeout(() => callbacks.onNodeTap(nodeId), 0);
    } else if (!moved && !pinchOccurred) {
      const now = performance.now();
      if (now - lastBgTapTime < 280) {
        if (bgTapTimer !== null) clearTimeout(bgTapTimer);
        bgTapTimer = null;
        callbacks.onBackgroundDoubleTap();
      } else {
        bgTapTimer = window.setTimeout(() => callbacks.onBackgroundTap(), 280);
      }
      lastBgTapTime = now;
    }
    if (pointers.size === 0) {
      mode = null;
      draggedNodeId = null;
      pinchOccurred = false;
    }
    performance.mark?.('knowledge-node-tap-end');
    performance.measure?.('knowledge-node-tap', 'knowledge-node-tap-start', 'knowledge-node-tap-end');
  };

  const wheel = (e: WheelEvent) => {
    if (overlayVisible) return;
    e.preventDefault();
    graphZoom = clampGraphZoom(graphZoom * Math.exp(-e.deltaY * .0015));
    largeGraphDirty = true;
  };

  const resize = () => {
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    largeGraphDirty = true;
  };

  const scheduleFrame = () => {
    if (!running || overlayVisible) return;
    const largeMobileGraph = mobilePerformance && getNodes().length > MOBILE_ACTIVE_NODE_TARGET;
    const delay = largeMobileGraph && pendingNodeIds.size === 0 ? 100 : 0;
    if (delay) {
      frameTimer = window.setTimeout(() => {
        frameTimer = null;
        rafId = requestAnimationFrame(frame);
      }, delay);
    } else {
      rafId = requestAnimationFrame(frame);
    }
  };

  const frame = (time = performance.now()) => {
    if (!running || overlayVisible) return;
    const largeMobileGraph = mobilePerformance && getNodes().length > MOBILE_ACTIVE_NODE_TARGET;
    if (mobilePerformance && time - lastFrameAt < 33) {
      scheduleFrame();
      return;
    }
    lastFrameAt = time;
    if (largeMobileGraph && !largeGraphDirty) {
      if (pendingNodeIds.size > 0) {
        applyPendingPulse(time);
        renderer.render(scene, camera);
      }
      scheduleFrame();
      return;
    }
    const dt = Math.min(clock.getDelta(), .05);
    if (!largeMobileGraph) physics(dt);
    sync();
    applyPendingPulse(time);
    labels();
    renderer.render(scene, camera);
    largeGraphDirty = false;
    scheduleFrame();
  };

  const pauseFrameLoop = () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
    if (frameTimer !== null) clearTimeout(frameTimer);
    frameTimer = null;
  };

  const resumeFrameLoop = () => {
    if (!running || overlayVisible) return;
    clock.start();
    lastFrameAt = 0;
    largeGraphDirty = true;
    frame();
  };

  renderer.domElement.addEventListener('pointerdown', down);
  renderer.domElement.addEventListener('pointermove', move);
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', up);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  resize();

  return {
    markDirty: () => { largeGraphDirty = true; },
    start: () => {
      if (!running) {
        running = true;
        resumeFrameLoop();
      }
    },
    stop: () => {
      running = false;
      pauseFrameLoop();
    },
    setOverlayVisible: visible => {
      if (overlayVisible === visible) return;
      overlayVisible = visible;
      labelsLayer.style.display = visible ? 'none' : 'block';
      if (visible) pauseFrameLoop();
      else resumeFrameLoop();
    },
    resize,
    setLabelBrightness: n => {
      labelBrightness = THREE.MathUtils.clamp(n, .1, 1);
      largeGraphDirty = true;
    },
    setNodeRadius: n => {
      nodeRadiusMM = THREE.MathUtils.clamp(n, .1, 30);
      largeGraphDirty = true;
    },
    setHideUntouched: enabled => {
      hideUntouched = enabled;
      applyVisibility();
      largeGraphDirty = true;
    },
    setCascadeDepthLimit: () => {},
    getCameraZ: () => camera.position.z,
    getVisibleEdgeCount: () => Object.values(edgeMap).filter(edge => edge.visible).length,
    getActiveNodeCount: () => Object.keys(nodeMap).length,
    screenPositionForNode: id => {
      const record = nodeMap[id];
      if (!record) return null;
      record.group.getWorldPosition(worldPos);
      const projected = worldPos.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return hasFiniteCoordinates(projected)
        ? {
          x: rect.left + (projected.x * .5 + .5) * rect.width,
          y: rect.top + (-projected.y * .5 + .5) * rect.height,
        }
        : null;
    },
  };
}
