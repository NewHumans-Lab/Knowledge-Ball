import * as THREE from 'three';
import {
  DEFAULT_CAM_Z,
  SUN_TRIAD_IDS,
  SUN_RADIUS_MM,
  SUN_GLOW_SCALE,
  SUN_ORBIT_RADIUS,
  SUN_ANGULAR_SPEED,
  SUN_REVEAL_CAM_Z,
  TYPE_COLOR,
  LAYER_BANDS,
  TWIN_REST_LEN,
  VIEW_ORDER,
  VIEW_PRESET_Z,
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

type NodeMeshRecord = {
  group: THREE.Group;
  shell: THREE.Mesh;
  dot: THREE.Sprite;
};

export function createKnowledgeScene(options: KnowledgeSceneOptions): KnowledgeSceneRuntime {
  const { host, labelsLayer, getNodes, callbacks } = options;

  let dirty = true;
  let running = false;
  let rafId = 0;

  let labelBrightness = 1;
  let nodeRadiusMM = 9;
  let hideUntouched = false;
  let targetCamZ: number | null = null;
  let selectedId: string | null = null;
  let draggedNodeId: string | null = null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.5, 8000);
  camera.position.set(0, 0, DEFAULT_CAM_Z);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const edgesGroup = new THREE.Group();
  const nodesGroup = new THREE.Group();
  worldGroup.add(edgesGroup);
  worldGroup.add(nodesGroup);

  const starfield = buildStarfield(scene);
  const dotTexStrong = createGlowTexture(true);
  const dotTexFluor = createGlowTexture(false);

  let nodeMeshMap: Record<string, NodeMeshRecord> = {};
  let edgeLineMap: Record<string, THREE.Line> = {};
  let labelElMap: Record<string, HTMLDivElement> = {};
  let twinLabelElMap: Record<string, HTMLDivElement> = {};

  let pointers = new Map<number, { x: number; y: number }>();
  let mode: 'rotate' | 'node' | 'pinch' | null = null;
  let pinchOccurred = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let pinchStartDist = 0;
  let pinchStartCamZ = DEFAULT_CAM_Z;
  let lastBgTapTime = 0;
  let bgTapTimer: number | null = null;

  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const v3 = new THREE.Vector3();

  function markDirty() {
    dirty = true;
  }

  function resize() {
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    dirty = true;
  }

  function setLabelBrightness(n: number) {
    labelBrightness = THREE.MathUtils.clamp(n, 0.1, 1);
    dirty = true;
  }

  function setNodeRadius(n: number) {
    nodeRadiusMM = THREE.MathUtils.clamp(n, 0.1, 30);
    dirty = true;
  }

  function setHideUntouched(enabled: boolean) {
    hideUntouched = enabled;
    applyHideUntouched();
    dirty = true;
  }

  function setCascadeDepthLimit(_: number | null) {
    // Kept for compatibility with the bootstrap layer.
    // Actual cascade depth is controlled in GraphProjection.
  }

  function getCameraZ() {
    return camera.position.z;
  }

  function setAppHeight() {
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
  }

  function createGlowTexture(strong: boolean) {
    const size = 128;
    const cvs = document.createElement('canvas');
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    const cx = size / 2;
    const cy = size / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);

    if (strong) {
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.18, 'rgba(255,245,215,1)');
      grad.addColorStop(0.45, 'rgba(255,225,150,0.55)');
      grad.addColorStop(1, 'rgba(255,215,12