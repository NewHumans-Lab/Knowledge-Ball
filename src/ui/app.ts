// @ts-nocheck
import * as THREE from 'three';
import { EventStore } from '../event/EventStore';
import { GraphProjection, setCascadeDepthLimit } from '../projection/GraphProjection';
import { nodeList, type GraphState } from '../state/GraphState';
import { createNode as cmdCreateNode } from '../command/CreateNode';
import { editNode as cmdEditNode } from '../command/EditNode';
import { falsifyNode as cmdFalsifyNode } from '../command/FalsifyNode';
import { resolveNode as cmdResolveNode } from '../command/ResolveNode';
import { setMastery as cmdSetMastery } from '../command/SetMastery';
import { disputeNode as cmdDisputeNode } from '../command/DisputeNode';
import { suspendNode as cmdSuspendNode } from '../command/SuspendNode';

const projection = new GraphProjection();
const store = new EventStore(() => structuredClone(projection.state));

let sceneDirty = true;
let panelRefreshId = null;

store.subscribe((event) => {
  projection.apply(event);
  sceneDirty = true;
});

const TWIN_META = {
  n6:  { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' },
  n15: { twinGroup: 'twinPrime', sharedTitle: '质数数量无穷' },
};

function setAppHeight(){ document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px'); }
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);

let nodes = [];

function syncNodesFromProjection(){
  const domainNodes = nodeList(projection.state);
  const prevById = {};
  nodes.forEach(n => { prevById[n.id] = n; });
  nodes = domainNodes.map(dn => {
    const prev = prevById[dn.id];
    const meta = TWIN_META[dn.id] || {};
    return {
      id: dn.id,
      title: dn.title,
      type: dn.type,
      status: dn.status,
      mastery: dn.mastery,
      reasoning: dn.reasoning,
      premises: dn.premises,
      ...meta,
      pos: prev ? prev.pos : undefined,
      vel: prev ? prev.vel : undefined,
      homePos: prev ? prev.homePos : undefined,
      layer: prev ? prev.layer : undefined,
    };
  });
}

const TYPE_LABEL = {axiom:'公理',definition:'定义',fact:'事实',theorem:'定理',hypothesis:'假说',prediction:'预测',opinion:'观点',value:'价值判断'};
const STATUS_LABEL = {verified:'已验证',pending:'等待验证',suspended:'悬置',disputed:'争议中',falsified:'已证伪'};
const MASTERY_LABEL = {none:'未接触（无光点）', touched:'接触过（荧光）', mastered:'完全掌握（强光）'};
const TYPE_COLOR = {axiom:0xE8E4D9,definition:0x7C93C9,fact:0x5BA88B,theorem:0xC9A227,hypothesis:0x9B7EDE,prediction:0x5FD1C9,opinion:0xE8825B,value:0xD8748A};
const TYPE_COLOR_HEX = {axiom:'#E8E4D9',definition:'#7C93C9',fact:'#5BA88B',theorem:'#C9A227',hypothesis:'#9B7EDE',prediction:'#5FD1C9',opinion:'#E8825B',value:'#D8748A'};
const STATUS_COLOR_HEX = {verified:'#5BA88B',pending:'#7C93C9',suspended:'#6B7290',disputed:'#E0A030',falsified:'#C85450'};

const LAYER_BANDS = { inner:{rMin:0,   rMax:95},  middle:{rMin:95,  rMax:170}, outer:{rMin:170, rMax:260} };
const LAYER_LABEL = {inner:'内层空间 · 基础', middle:'中层空间 · 高置信度', outer:'外层空间 · 待定/推测'};
const TWIN_REST_LEN = 14;

let selectedId = null;
let editMode = false;
let labelBrightness = 1;
let nodeRadiusMM = 9;
let hideUntouched = false;

function nodeById(id){ return nodes.find(n => n.id === id); }
function dependentsOf(id){ return nodes.filter(n => n.premises.includes(id)); }
function twinsOf(id){
  const n = nodeById(id);
  if(!n || !n.twinGroup) return [];
  return nodes.filter(x => x.twinGroup === n.twinGroup && x.id !== id);
}
function getLayer(node){
  if(node.status === 'verified'){
    if(node.type === 'definition' || node.type === 'fact') return 'inner';
    if(node.type === 'axiom' || node.type === 'theorem') return 'middle';
  }
  return 'outer';
}

const host = document.getElementById('canvasHost');
const scene = new THREE.Scene();
const REF_CAMERA_Z = 640;
const camera = new THREE.PerspectiveCamera(50, host.clientWidth/host.clientHeight, 0.5, 8000);
camera.position.set(0,0,REF_CAMERA_Z);
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.setSize(host.clientWidth, host.clientHeight);
host.appendChild(renderer.domElement);

function buildStarfield(){
  const starCount = 900;
  const positions = new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    const r = 1200 + Math.random()*2600;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos(2*Math.random()-1);
    positions[i*3] = r*Math.sin(phi)*Math.cos(theta);
    positions[i*3+1] = r*Math.sin(phi)*Math.sin(theta);
    positions[i*3+2] = r*Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const mat = new THREE.PointsMaterial({color:0xAEB8D6, size:2.6, sizeAttenuation:true, transparent:true, opacity:0.55});
  const stars = new THREE.Points(geo, mat);
  scene.add(stars);
  return stars;
}
const starfield = buildStarfield();

const worldGroup = new THREE.Group();
scene.add(worldGroup);
const edgesGr = new THREE.Group();
