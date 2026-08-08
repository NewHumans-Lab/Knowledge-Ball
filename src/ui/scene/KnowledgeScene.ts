import * as THREE from 'three';
import {
  DEFAULT_CAM_Z,
  SUN_TRIAD_IDS,
  SUN_RADIUS_MM,
  SUN_ORBIT_RADIUS,
  SUN_ANGULAR_SPEED,
  SUN_REVEAL_CAM_Z,
  TYPE_COLOR,
  LAYER_BANDS,
  TWIN_REST_LEN,
} from '../config/KnowledgeUiConfig';

export interface KnowledgeSceneNode {
  id: string;
  title: string;
  type: keyof typeof TYPE_COLOR;
  status: 'pending' | 'verified' | 'suspended' | 'disputed' | 'falsified';
  mastery: 'none' | 'touched' | 'mastered';
  reasoning: string;
  premises: string[];
  twinGroup?: string;
  sharedTitle?: string;
  pos?: THREE.Vector3;
  vel?: THREE.Vector3;
  homePos?: THREE.Vector3;
  layer?: 'inner' | 'middle' | 'outer' | 'core';
}

export interface KnowledgeSceneCallbacks {
  onSelectNode: (id: string) => void;
  onOpenPanel: (id: string) => void;
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
  resize: () => void;
  setLabelBrightness: (n: number) => void;
  setNodeRadius: (n: number) => void;
  setHideUntouched: (enabled: boolean) => void;
  setCascadeDepthLimit: (n: number | null) => void;
  getCameraZ: () => number;
}

type NodeMeshRecord = { group: THREE.Group; shell: THREE.Mesh; dot: THREE.Sprite };
type Layer = NonNullable<KnowledgeSceneNode['layer']>;

export function isCoreNodeId(id: string): boolean {
  return (SUN_TRIAD_IDS as readonly string[]).includes(id);
}

export function layerForNode(node: Pick<KnowledgeSceneNode, 'id' | 'status' | 'type'>): Layer {
  if (isCoreNodeId(node.id)) return 'core';
  if (node.status === 'pending' || node.status === 'suspended' || node.status === 'disputed') return 'outer';
  if (node.type === 'axiom' || node.type === 'definition') return 'inner';
  return 'middle';
}

function hash01(input: string, salt: number): number {
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

/** Deterministic uniform-in-volume position inside the node's spherical layer. */
export function initialNodePosition(node: Pick<KnowledgeSceneNode, 'id' | 'status' | 'type'>): THREE.Vector3 {
  const layer = layerForNode(node);
  if (layer === 'core') {
    const i = Math.max(0, SUN_TRIAD_IDS.indexOf(node.id as (typeof SUN_TRIAD_IDS)[number]));
    const a = i * Math.PI * 2 / SUN_TRIAD_IDS.length;
    return new THREE.Vector3(Math.cos(a) * SUN_ORBIT_RADIUS, Math.sin(a) * SUN_ORBIT_RADIUS, 0);
  }
  const band = LAYER_BANDS[layer];
  const u = hash01(node.id, 11);
  const v = hash01(node.id, 29);
  const w = hash01(node.id, 47);
  const z = 1 - 2 * u;
  const phi = Math.PI * 2 * v;
  const xy = Math.sqrt(Math.max(0, 1 - z * z));
  const r = Math.cbrt(band.rMin ** 3 + w * (band.rMax ** 3 - band.rMin ** 3));
  return new THREE.Vector3(r * xy * Math.cos(phi), r * xy * Math.sin(phi), r * z);
}

export function shouldRenderEdge(fromId: string, toId: string): boolean {
  return !isCoreNodeId(fromId) && !isCoreNodeId(toId);
}

export function createKnowledgeScene(options: KnowledgeSceneOptions): KnowledgeSceneRuntime {
  const { host, labelsLayer, getNodes, callbacks } = options;
  let dirty = true;
  let running = false;
  let rafId = 0;
  let labelBrightness = 1;
  let nodeRadiusMM = 9;
  let hideUntouched = false;
  let selectedId: string | null = null;
  let draggedNodeId: string | null = null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / Math.max(host.clientHeight, 1), 0.5, 8000);
  camera.position.set(0, 0, DEFAULT_CAM_Z);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  const edgesGroup = new THREE.Group();
  const nodesGroup = new THREE.Group();
  scene.add(worldGroup);
  worldGroup.add(edgesGroup, nodesGroup);
  buildStarfield(scene);

  const dotTexStrong = createGlowTexture(true);
  const dotTexFluor = createGlowTexture(false);
  const nodeMeshMap: Record<string, NodeMeshRecord> = {};
  const edgeLineMap: Record<string, THREE.Line> = {};
  const labelElMap: Record<string, HTMLDivElement> = {};
  const pointers = new Map<number, { x: number; y: number }>();
  let mode: 'rotate' | 'node' | 'pinch' | null = null;
  let pinchOccurred = false;
  let downX = 0, downY = 0, lastX = 0, lastY = 0;
  let pinchStartDist = 0, pinchStartCamZ = DEFAULT_CAM_Z;
  let lastBgTapTime = 0;
  let bgTapTimer: number | null = null;
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const scratch = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();

  function markDirty() { dirty = true; }
  function resize() {
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    dirty = true;
  }
  function setLabelBrightness(n: number) { labelBrightness = THREE.MathUtils.clamp(n, 0.1, 1); dirty = true; }
  function setNodeRadius(n: number) { nodeRadiusMM = THREE.MathUtils.clamp(n, 0.1, 30); dirty = true; }
  function setHideUntouched(enabled: boolean) { hideUntouched = enabled; applyVisibility(); dirty = true; }
  function setCascadeDepthLimit(_: number | null) { /* Domain projection owns cascade filtering. */ }
  function getCameraZ() { return camera.position.z; }

  function createGlowTexture(strong: boolean) {
    const size = 128;
    const cvs = document.createElement('canvas');
    cvs.width = size; cvs.height = size;
    const ctx = cvs.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (strong) {
      grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.18, 'rgba(255,245,215,1)');
      grad.addColorStop(0.45, 'rgba(255,225,150,0.55)'); grad.addColorStop(1, 'rgba(255,215,120,0)');
    } else {
      grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.28, 'rgba(120,240,220,0.55)');
      grad.addColorStop(1, 'rgba(95,209,201,0)');
    }
    ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(cvs); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }

  function buildStarfield(target: THREE.Scene) {
    const vertices: number[] = [];
    for (let i = 0; i < 500; i += 1) vertices.push((Math.random() - .5) * 1800, (Math.random() - .5) * 1200, -900 - Math.random() * 1200);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    target.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xb8bfd4, size: 1.2, transparent: true, opacity: .45 })));
  }

  function ensureNode(node: KnowledgeSceneNode): NodeMeshRecord {
    if (nodeMeshMap[node.id]) return nodeMeshMap[node.id];
    const group = new THREE.Group(); group.userData.nodeId = node.id;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: TYPE_COLOR[node.type], wireframe: true, transparent: true, opacity: .45 }));
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexFluor, transparent: true, opacity: .9, depthWrite: false }));
    group.add(shell, dot); nodesGroup.add(group);
    const label = document.createElement('div'); label.className = 'node-label'; label.textContent = node.title; labelsLayer.appendChild(label);
    labelElMap[node.id] = label;
    return nodeMeshMap[node.id] = { group, shell, dot };
  }

  function placeNode(node: KnowledgeSceneNode) {
    node.layer = layerForNode(node);
    node.pos = initialNodePosition(node);
    node.vel = new THREE.Vector3();
    node.homePos = node.pos.clone();
  }

  function syncScene() {
    const nodes = getNodes();
    const ids = new Set(nodes.map(n => n.id));
    Object.keys(nodeMeshMap).forEach(id => {
      if (!ids.has(id)) {
        nodesGroup.remove(nodeMeshMap[id].group); labelElMap[id]?.remove(); delete nodeMeshMap[id]; delete labelElMap[id];
      }
    });
    nodes.forEach(node => {
      if (!node.pos) placeNode(node);
      const record = ensureNode(node);
      record.group.position.copy(node.pos!);
      const radius = isCoreNodeId(node.id) && camera.position.z <= SUN_REVEAL_CAM_Z ? SUN_RADIUS_MM : nodeRadiusMM;
      record.shell.scale.setScalar(radius);
      record.dot.scale.setScalar(node.mastery === 'mastered' ? radius * 3 : node.mastery === 'touched' ? radius * 2.2 : .01);
      (record.dot.material as THREE.SpriteMaterial).map = node.mastery === 'mastered' ? dotTexStrong : dotTexFluor;
      (record.shell.material as THREE.MeshBasicMaterial).color.setHex(TYPE_COLOR[node.type]);
    });
    syncEdges(nodes); applyVisibility();
  }

  function syncEdges(nodes: KnowledgeSceneNode[]) {
    const ids = new Set(nodes.map(n => n.id));
    const wanted = new Set<string>();
    nodes.forEach(node => node.premises.forEach(parent => {
      if (!ids.has(parent) || !shouldRenderEdge(parent, node.id)) return;
      const key = `${parent}->${node.id}`; wanted.add(key);
      if (!edgeLineMap[key]) { edgeLineMap[key] = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7c93c9, transparent: true, opacity: .32 })); edgesGroup.add(edgeLineMap[key]); }
      updateLine(edgeLineMap[key], nodeMeshMap[parent]?.group.position, nodeMeshMap[node.id]?.group.position);
    }));
    nodes.filter(n => n.twinGroup && !isCoreNodeId(n.id)).forEach(node => {
      const twin = nodes.find(n => n.id !== node.id && n.twinGroup === node.twinGroup && shouldRenderEdge(node.id, n.id));
      if (!twin) return;
      const key = [node.id, twin.id].sort().join('<->'); wanted.add(key);
      if (!edgeLineMap[key]) { edgeLineMap[key] = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffd978, transparent: true, opacity: .5, dashSize: 4, gapSize: 3 })); edgesGroup.add(edgeLineMap[key]); }
      updateLine(edgeLineMap[key], nodeMeshMap[node.id]?.group.position, nodeMeshMap[twin.id]?.group.position);
    });
    Object.keys(edgeLineMap).forEach(key => { if (!wanted.has(key)) { edgesGroup.remove(edgeLineMap[key]); edgeLineMap[key].geometry.dispose(); delete edgeLineMap[key]; } });
  }

  function updateLine(line: THREE.Line, from?: THREE.Vector3, to?: THREE.Vector3) {
    if (!from || !to) return;
    line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    if ('computeLineDistances' in line) line.computeLineDistances();
  }

  function applyVisibility() {
    getNodes().forEach(node => {
      // The core is structural and must never disappear. Other nodes hide only when the user explicitly enables the personal filter.
      const visible = isCoreNodeId(node.id) || !hideUntouched || node.mastery !== 'none';
      const record = nodeMeshMap[node.id]; if (record) record.group.visible = visible;
      if (labelElMap[node.id]) labelElMap[node.id].style.display = visible ? '' : 'none';
    });
  }

  function updatePhysics(dt: number) {
    const nodes = getNodes();
    nodes.forEach(node => {
      if (!node.pos) placeNode(node);
      if (draggedNodeId === node.id) return;
      if (isCoreNodeId(node.id)) {
        const i = SUN_TRIAD_IDS.indexOf(node.id as (typeof SUN_TRIAD_IDS)[number]);
        const a = clock.elapsedTime * SUN_ANGULAR_SPEED + i * Math.PI * 2 / SUN_TRIAD_IDS.length;
        node.pos!.set(Math.cos(a) * SUN_ORBIT_RADIUS, Math.sin(a) * SUN_ORBIT_RADIUS, Math.sin(a * .5) * SUN_ORBIT_RADIUS * .35);
        return;
      }
      if (!node.vel) node.vel = new THREE.Vector3();
      if (!node.homePos) node.homePos = node.pos!.clone();
      node.vel.add(scratch.copy(node.homePos).sub(node.pos!).multiplyScalar(.02));
      nodes.forEach(other => {
        if (other === node || !other.pos) return;
        const delta = scratch.copy(node.pos!).sub(other.pos); const distSq = Math.max(delta.lengthSq(), 80);
        node.vel!.add(delta.normalize().multiplyScalar(12 / distSq));
      });
      if (node.twinGroup) {
        const twin = nodes.find(n => n !== node && n.twinGroup === node.twinGroup && n.pos);
        if (twin?.pos) { const delta = scratch.copy(twin.pos).sub(node.pos!); node.vel.add(delta.multiplyScalar((delta.length() - TWIN_REST_LEN) * .002)); }
      }
      node.vel.multiplyScalar(.88); node.pos!.addScaledVector(node.vel, dt * 60);
    });
  }

  function updateLabels() {
    // HTML labels live outside worldGroup, so they must use each mesh's world transform, not its local position.
    scene.updateMatrixWorld(true);
    getNodes().forEach(node => {
      const label = labelElMap[node.id], record = nodeMeshMap[node.id]; if (!label || !record) return;
      record.group.getWorldPosition(worldPosition);
      const screen = worldPosition.clone().project(camera);
      const visible = record.group.visible && screen.z > -1 && screen.z < 1;
      label.style.display = visible ? '' : 'none'; if (!visible) return;
      label.style.transform = `translate(-50%, -50%) translate(${(screen.x * .5 + .5) * host.clientWidth}px, ${(-screen.y * .5 + .5) * host.clientHeight}px)`;
      label.style.opacity = String(labelBrightness); label.classList.toggle('selected', selectedId === node.id);
    });
  }

  function pickNode(x: number, y: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1)); raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(Object.values(nodeMeshMap).filter(r => r.group.visible).map(r => r.shell), false);
    const hit = hits[0]?.object.parent?.userData.nodeId; return typeof hit === 'string' ? hit : null;
  }

  function onPointerDown(ev: PointerEvent) {
    renderer.domElement.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    downX = lastX = ev.clientX; downY = lastY = ev.clientY;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y); pinchStartCamZ = camera.position.z; pinchOccurred = true; mode = 'pinch'; return; }
    draggedNodeId = pickNode(ev.clientX, ev.clientY); mode = draggedNodeId ? 'node' : 'rotate';
  }

  function onPointerMove(ev: PointerEvent) {
    if (!pointers.has(ev.pointerId)) return; pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (mode === 'pinch' && pointers.size >= 2) { const [a, b] = [...pointers.values()]; const dist = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1); camera.position.z = THREE.MathUtils.clamp(pinchStartCamZ * pinchStartDist / dist, 30, DEFAULT_CAM_Z * 1.3); }
    else if (mode === 'rotate') { worldGroup.rotation.y += (ev.clientX - lastX) * .004; worldGroup.rotation.x += (ev.clientY - lastY) * .004; }
    else if (mode === 'node' && draggedNodeId) {
      const node = getNodes().find(n => n.id === draggedNodeId);
      if (node?.pos) {
        // Convert screen-plane drag into the rotated world's local coordinate system so the sphere and label remain locked together.
        const deltaWorld = new THREE.Vector3((ev.clientX - lastX) * .45, -(ev.clientY - lastY) * .45, 0);
        const inverseWorldRotation = worldGroup.quaternion.clone().invert();
        deltaWorld.applyQuaternion(inverseWorldRotation); node.pos.add(deltaWorld); node.homePos = node.pos.clone();
      }
    }
    lastX = ev.clientX; lastY = ev.clientY; dirty = true;
  }

  function onPointerUp(ev: PointerEvent) {
    pointers.delete(ev.pointerId); const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6;
    const nodeId = !moved && !pinchOccurred ? pickNode(ev.clientX, ev.clientY) : null;
    if (nodeId) { selectedId = nodeId; callbacks.onSelectNode(nodeId); callbacks.onOpenPanel(nodeId); }
    else if (!moved && !pinchOccurred) {
      const now = window.performance.now();
      if (now - lastBgTapTime < 280) { if (bgTapTimer !== null) window.clearTimeout(bgTapTimer); bgTapTimer = null; callbacks.onBackgroundDoubleTap(); }
      else bgTapTimer = window.setTimeout(() => callbacks.onBackgroundTap(), 280);
      lastBgTapTime = now;
    }
    if (pointers.size === 0) { mode = null; draggedNodeId = null; pinchOccurred = false; } dirty = true;
  }

  function onWheel(ev: WheelEvent) { ev.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z + ev.deltaY * .55, 30, DEFAULT_CAM_Z * 1.3); dirty = true; }

  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), .05);
    syncScene(); updatePhysics(dt); syncScene(); updateLabels();
    // Physics changes every frame. Rendering only when `dirty` made HTML labels move while WebGL spheres stayed frozen.
    renderer.render(scene, camera); dirty = false;
    rafId = window.requestAnimationFrame(frame);
  }
  function start() { if (running) return; running = true; clock.start(); frame(); }
  function stop() { running = false; window.cancelAnimationFrame(rafId); }

  renderer.domElement.addEventListener('pointerdown', onPointerDown); renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp); renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
  return { markDirty, start, stop, resize, setLabelBrightness, setNodeRadius, setHideUntouched, setCascadeDepthLimit, getCameraZ };
}
