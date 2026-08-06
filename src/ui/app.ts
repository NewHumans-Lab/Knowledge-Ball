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
const edgesGroup = new THREE.Group(); worldGroup.add(edgesGroup);
const nodesGroup = new THREE.Group(); worldGroup.add(nodesGroup);
const labelsLayer = document.getElementById('labelsLayer');

function createGlowTexture(strong){
  const size=128, cvs=document.createElement('canvas'); cvs.width=size; cvs.height=size;
  const ctx=cvs.getContext('2d'); const cx=size/2, cy=size/2;
  const grad=ctx.createRadialGradient(cx,cy,0,cx,cy,size/2);
  if(strong){
    grad.addColorStop(0,'rgba(255,255,255,1)');
    grad.addColorStop(0.18,'rgba(255,245,215,1)');
    grad.addColorStop(0.45,'rgba(255,225,150,0.55)');
    grad.addColorStop(1,'rgba(255,215,120,0)');
  } else {
    grad.addColorStop(0,'rgba(235,245,255,0.85)');
    grad.addColorStop(0.3,'rgba(200,220,255,0.4)');
    grad.addColorStop(0.6,'rgba(180,210,255,0.15)');
    grad.addColorStop(1,'rgba(180,210,255,0)');
  }
  ctx.fillStyle=grad; ctx.fillRect(0,0,size,size);
  return new THREE.CanvasTexture(cvs);
}
const dotTexStrong = createGlowTexture(true);
const dotTexFluor = createGlowTexture(false);

let nodeMeshMap = {};
let edgeLineMap = {};
let labelElMap = {};
let twinLabelElMap = {};

function disposeObj(obj){ obj.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); }); }

function buildScene(){
  while(nodesGroup.children.length){ disposeObj(nodesGroup.children.pop()); }
  while(edgesGroup.children.length){ disposeObj(edgesGroup.children.pop()); }
  nodeMeshMap = {}; edgeLineMap = {}; labelsLayer.innerHTML = ''; labelElMap = {}; twinLabelElMap = {};

  nodes.forEach(node => {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({color:TYPE_COLOR[node.type], transparent:true, opacity:0.6, depthWrite:false})
    );
    shell.scale.setScalar(nodeRadiusMM);
    shell.userData.nodeId = node.id;

    const dot = new THREE.Sprite(new THREE.SpriteMaterial({map:dotTexFluor, transparent:true, depthWrite:false}));
    dot.scale.set(1,1,1);

    g.add(shell); g.add(dot);
    nodesGroup.add(g);
    nodeMeshMap[node.id] = {group:g, shell, dot};

    const label = document.createElement('div');
    label.className = 'node-label';
    labelsLayer.appendChild(label);
    labelElMap[node.id] = label;
  });

  nodes.forEach(node => {
    node.premises.forEach(pid => {
      if(!nodeById(pid)) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({color:0x9AA1B8, transparent:true, opacity:0.28});
      const line = new THREE.Line(geo, mat);
      edgesGroup.add(line);
      edgeLineMap[pid+'|'+node.id] = line;
    });
  });

  const seenGroups = new Set();
  nodes.forEach(node => {
    if(!node.twinGroup || seenGroups.has(node.twinGroup)) return;
    seenGroups.add(node.twinGroup);
    const members = nodes.filter(n => n.twinGroup === node.twinGroup);
    const m = members.length;
    const edgeCount = m<2 ? 0 : (m===2 ? 1 : m);
    for(let i=0;i<edgeCount;i++){
      const a = members[i], b = members[(i+1)%m];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({color:0xC9A227, transparent:true, opacity:0.75});
      const line = new THREE.Line(geo, mat);
      edgesGroup.add(line);
      edgeLineMap['twin|'+a.id+'|'+b.id] = line;
    }
    const tl = document.createElement('div');
    tl.className = 'twin-label';
    tl.textContent = node.sharedTitle || '';
    labelsLayer.appendChild(tl);
    twinLabelElMap[node.twinGroup] = tl;
  });

  assignLayersAndHome();
  nodes.forEach(updateNodeAppearance);
  applyHideUntouched();
  updateSelectionVisuals();
}

function sampleVolumePoint(i, n, rMin, rMax){
  const yy = n<=1 ? 0 : 1 - (i/(n-1))*2;
  const radiusAtY = Math.sqrt(Math.max(0,1-yy*yy));
  const theta = Math.PI*(3-Math.sqrt(5))*i;
  const dirX = Math.cos(theta)*radiusAtY, dirZ = Math.sin(theta)*radiusAtY, dirY = yy;
  const frac = (i*0.6180339887 + 0.15) % 1;
  const r3 = rMin*rMin*rMin + frac*(rMax*rMax*rMax - rMin*rMin*rMin);
  return new THREE.Vector3(dirX*Math.cbrt(r3), dirY*Math.cbrt(r3), dirZ*Math.cbrt(r3));
}

function assignLayersAndHome(){
  const byLayer = {inner:[], middle:[], outer:[]};
  nodes.forEach(n => { n.layer = getLayer(n); byLayer[n.layer].push(n); });
  ['inner','middle','outer'].forEach(layer => {
    const list = byLayer[layer];
    const band = LAYER_BANDS[layer];
    list.forEach((node,i) => {
      node.homePos = sampleVolumePoint(i, list.length, band.rMin, band.rMax);
      if(!node.pos) node.pos = node.homePos.clone();
      if(!node.vel) node.vel = new THREE.Vector3();
    });
  });
}

function updateNodeAppearance(node){
  const m = nodeMeshMap[node.id];
  if(!m) return;
  const baseColor = TYPE_COLOR[node.type];
  let opacity;
  if(node.status === 'falsified'){ m.shell.material.color.setHex(0xC85450); opacity = 0.82; }
  else if(node.status === 'suspended'){ m.shell.material.color.setHex(baseColor); opacity = 0.14; }
  else if(node.status === 'pending'){ m.shell.material.color.setHex(baseColor); opacity = 0.32; }
  else { m.shell.material.color.setHex(baseColor); opacity = 0.6; }
  m.shell.material.opacity = opacity;
  m.shell.userData.baseOpacity = opacity;
  m.shell.userData.pulsing = (node.status === 'disputed');
  m.shell.scale.setScalar(nodeRadiusMM);

  if(node.mastery === 'mastered'){
    m.dot.visible = true;
    m.dot.material.map = dotTexStrong;
    m.dot.material.blending = THREE.AdditiveBlending;
    m.dot.material.opacity = 1;
    m.dot.scale.setScalar(nodeRadiusMM*2.3);
  } else if(node.mastery === 'touched'){
    m.dot.visible = true;
    m.dot.material.map = dotTexFluor;
    m.dot.material.blending = THREE.AdditiveBlending;
    m.dot.material.opacity = 0.6;
    m.dot.scale.setScalar(nodeRadiusMM*1.5);
  } else {
    m.dot.visible = false;
  }
  m.dot.material.needsUpdate = true;
}

function applyHideUntouched(){
  nodes.forEach(n => {
    const m = nodeMeshMap[n.id];
    if(!m) return;
    const shouldHide = hideUntouched && n.mastery==='none';
    m.group.visible = !shouldHide;
    if(labelElMap[n.id]) labelElMap[n.id].style.display = shouldHide ? 'none' : '';
  });
  Object.keys(edgeLineMap).forEach(key => {
    const parts = key.split('|'); const isTwin = parts[0]==='twin';
    const a = isTwin?parts[1]:parts[0], b = isTwin?parts[2]:parts[1];
    const na = nodeById(a), nb = nodeById(b);
    const shouldHide = hideUntouched && ((na&&na.mastery==='none')||(nb&&nb.mastery==='none'));
    edgeLineMap[key].visible = !shouldHide;
  });
}

function updateSelectionVisuals(){
  Object.keys(nodeMeshMap).forEach(id => {
    const m = nodeMeshMap[id];
    let related = true;
    if(selectedId){
      const sel = nodeById(selectedId);
      related = sel && (id===selectedId || sel.premises.includes(id) || (nodeById(id) && nodeById(id).premises.includes(selectedId)) || (sel.twinGroup && nodeById(id) && nodeById(id).twinGroup===sel.twinGroup));
    }
    m.group.userData.dimFactor = selectedId ? (related?1:0.2) : 1;
    m.group.userData.selBoost = (id===selectedId) ? 1.35 : 1.0;
  });
  Object.keys(edgeLineMap).forEach(key => {
    const parts = key.split('|');
    const isTwin = parts[0]==='twin';
    const a = isTwin?parts[1]:parts[0], b = isTwin?parts[2]:parts[1];
    const line = edgeLineMap[key];
    const isHi = selectedId && (a===selectedId || b===selectedId);
    if(isTwin){ line.material.opacity = isHi ? 0.95 : 0.6; }
    else { line.material.opacity = isHi ? 0.85 : 0.22; line.material.color.set(isHi ? 0xC9A227 : 0x9AA1B8); }
  });
}

const clock = new THREE.Clock();
let draggedNodeId = null;

function physicsStep(){
  nodes.forEach(node => {
    if(node.id === draggedNodeId) return;
    const force = new THREE.Vector3();
    force.add(node.homePos.clone().sub(node.pos).multiplyScalar(0.010));

    [...node.premises, ...dependentsOf(node.id).map(d=>d.id)].forEach(lid => {
      const other = nodeById(lid);
      if(!other || !other.pos) return;
      force.add(other.pos.clone().sub(node.pos).multiplyScalar(0.006));
    });

    nodes.forEach(other => {
      if(other.id===node.id || other.layer!==node.layer || !other.pos) return;
      if(node.twinGroup && other.twinGroup===node.twinGroup) return;
      const diff = node.pos.clone().sub(other.pos);
      const dist = Math.max(diff.length(), 8);
      if(dist < 65) force.add(diff.normalize().multiplyScalar((65-dist)*0.0055));
    });

    if(node.twinGroup){
      nodes.forEach(other => {
        if(other.id===node.id || other.twinGroup!==node.twinGroup || !other.pos) return;
        const diff = other.pos.clone().sub(node.pos);
        const dist = Math.max(diff.length(), 0.001);
        force.add(diff.normalize().multiplyScalar((dist-TWIN_REST_LEN)*0.02));
      });
    }

    node.vel.add(force).multiplyScalar(0.86);
    node.pos.add(node.vel);

    const band = LAYER_BANDS[node.layer];
    const r = node.pos.length();
    if(r > band.rMax) node.pos.setLength(band.rMax);
    else if(r < band.rMin && r > 0.0001) node.pos.setLength(band.rMin);
    else if(r <= 0.0001 && band.rMin > 0) node.pos.set(band.rMin, 0, 0);
  });
}

const VIEW_ORDER = ['outer','middle','inner'];
const VIEW_PRESET_Z = {outer:640, middle:420, inner:230};
let currentViewIdx = 0;
let targetCamZ = null;
function walkView(dir){
  currentViewIdx = THREE.MathUtils.clamp(currentViewIdx + dir, 0, VIEW_ORDER.length-1);
  targetCamZ = VIEW_PRESET_Z[VIEW_ORDER[currentViewIdx]];
}

function renderLoop(){
  requestAnimationFrame(renderLoop);

  if(sceneDirty){
    syncNodesFromProjection();
    buildScene();
    sceneDirty = false;
    if(panelRefreshId && nodeById(panelRefreshId)) openPanel(panelRefreshId);
  }

  physicsStep();
  starfield.rotation.y += 0.00006;

  if(targetCamZ !== null){
    camera.position.z += (targetCamZ - camera.position.z)*0.12;
    if(Math.abs(targetCamZ - camera.position.z) < 0.8){ camera.position.z = targetCamZ; targetCamZ = null; }
  }

  const sizeScale = camera.position.z / REF_CAMERA_Z;
  nodes.forEach(node => {
    const m = nodeMeshMap[node.id];
    if(!m) return;
    m.group.position.copy(node.pos);
    const boost = m.group.userData.selBoost || 1;
    m.group.scale.setScalar(sizeScale * boost);
    if(m.shell.userData.pulsing){
      m.shell.material.opacity = THREE.MathUtils.clamp(m.shell.userData.baseOpacity + Math.sin(clock.elapsedTime*2.4)*0.18, 0.1, 0.85);
    }
  });

  Object.keys(edgeLineMap).forEach(key => {
    const parts = key.split('|');
    const isTwin = parts[0]==='twin';
    const a = isTwin?parts[1]:parts[0], b = isTwin?parts[2]:parts[1];
    const na = nodeById(a), nb = nodeById(b);
    if(!na || !nb) return;
    const line = edgeLineMap[key];
    const arr = line.geometry.attributes.position.array;
    arr[0]=na.pos.x; arr[1]=na.pos.y; arr[2]=na.pos.z;
    arr[3]=nb.pos.x; arr[4]=nb.pos.y; arr[5]=nb.pos.z;
    line.geometry.attributes.position.needsUpdate = true;
  });

  updateLabels();
  renderer.render(scene, camera);
}

function updateLabels(){
  const w = host.clientWidth, h = host.clientHeight;
  const v = new THREE.Vector3();
  nodes.forEach(node => {
    const el = labelElMap[node.id];
    if(!el || el.style.display==='none') return;
    v.copy(node.pos).applyMatrix4(worldGroup.matrixWorld).project(camera);
    if(v.z > 1){ el.style.opacity = 0; return; }
    el.style.left = ((v.x*0.5+0.5)*w)+'px';
    el.style.top = ((-(v.y*0.5)+0.5)*h)+'px';
    const m = nodeMeshMap[node.id];
    const dimFactor = m ? (m.group.userData.dimFactor ?? 1) : 1;
    const depthFade = THREE.MathUtils.clamp(1 - (v.z+0.3)*0.55, 0.62, 1);
    el.style.opacity = String(dimFactor*depthFade*labelBrightness);
    el.textContent = node.title.length>18 ? node.title.slice(0,18)+'…' : node.title;
  });

  Object.keys(twinLabelElMap).forEach(groupId => {
    const members = nodes.filter(n => n.twinGroup === groupId);
    if(!members.length) return;
    const centroid = new THREE.Vector3();
    members.forEach(m => centroid.add(m.pos));
    centroid.multiplyScalar(1/members.length);
    v.copy(centroid).applyMatrix4(worldGroup.matrixWorld).project(camera);
    const el = twinLabelElMap[groupId];
    if(v.z > 1){ el.style.opacity = 0; return; }
    el.style.left = ((v.x*0.5+0.5)*w)+'px';
    el.style.top = ((-(v.y*0.5)+0.5)*h)+'px';
    el.style.opacity = String(0.9*labelBrightness);
  });
}

worldGroup.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster();
let pointers = new Map();
let mode = null;
let pinchOccurred = false;
let downX=0, downY=0, lastX=0, lastY=0;
let pinchStartDist=0, pinchStartCamZ=REF_CAMERA_Z;
let lastBgTapTime = 0, bgTapTimer = null;

function ndcFromXY(x,y){
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((x-rect.left)/rect.width)*2-1, -((y-rect.top)/rect.height)*2+1);
}
function pickNodeAt(x,y){
  raycaster.setFromCamera(ndcFromXY(x,y), camera);
  const shells = Object.values(nodeMeshMap).filter(m=>m.group.visible).map(m=>m.shell);
  const hits = raycaster.intersectObjects(shells);
  return hits.length ? hits[0].object.userData.nodeId : null;
}
function clampCamZ(z){ return THREE.MathUtils.clamp(z, 4, 1400); }

renderer.domElement.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});
  try{ renderer.domElement.setPointerCapture(e.pointerId); }catch(err){}
  host.classList.add('dragging');

  if(pointers.size === 1){
    downX=lastX=e.clientX; downY=lastY=e.clientY;
    const hitId = pickNodeAt(e.clientX, e.clientY);
    if(hitId){ mode='node'; draggedNodeId=hitId; } else { mode='rotate'; }
  } else if(pointers.size === 2){
    mode = 'pinch'; draggedNodeId = null; targetCamZ = null;
    pinchOccurred = true;
    const pts = [...pointers.values()];
    pinchStartDist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    pinchStartCamZ = camera.position.z;
  }
});

renderer.domElement.addEventListener('pointermove', e => {
  if(!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

  if(mode === 'pinch' && pointers.size >= 2){
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
    const ratio = dist / (pinchStartDist || 1);
    targetCamZ = null;
    camera.position.z = clampCamZ(pinchStartCamZ / ratio);
    return;
  }

  if(pointers.size === 1){
    const dx = e.clientX-lastX, dy = e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    if(mode === 'rotate'){
      worldGroup.rotation.y += dx*0.006;
      worldGroup.rotation.x += dy*0.006;
    } else if(mode === 'node' && draggedNodeId){
      raycaster.setFromCamera(ndcFromXY(e.clientX, e.clientY), camera);
      const node = nodeById(draggedNodeId);
      const band = LAYER_BANDS[node.layer];
      const dragR = (band.rMin+band.rMax)/2;
      const hit = new THREE.Vector3();
      const ok = raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(0,0,0), dragR), hit);
      if(ok){
        worldGroup.updateMatrixWorld(true);
        const local = worldGroup.worldToLocal(hit.clone());
        const r = THREE.MathUtils.clamp(local.length(), band.rMin, band.rMax);
        local.setLength(r);
        node.pos.copy(local);
        node.vel.set(0,0,0);
      }
    }
  }
});

function handleBackgroundTap(){
  const now = performance.now();
  if(now - lastBgTapTime < 320){
    clearTimeout(bgTapTimer); bgTapTimer = null;
    walkView(1);
    lastBgTapTime = 0;
  } else {
    lastBgTapTime = now;
    bgTapTimer = setTimeout(() => {
      walkView(-1);
      selectedId = null;
      document.getElementById('panel').classList.remove('open');
      updateSelectionVisuals();
      bgTapTimer = null;
    }, 320);
  }
}

function endPointer(e){
  const singlePos = pointers.size===1 ? pointers.get(e.pointerId) : null;
  pointers.delete(e.pointerId);

  if(pointers.size === 1){
    const remaining = [...pointers.values()][0];
    lastX = downX = remaining.x; lastY = downY = remaining.y;
    mode = 'rotate'; draggedNodeId = null;
    return;
  }
  if(pointers.size === 0){
    host.classList.remove('dragging');
    if(!pinchOccurred && singlePos){
      const moved = Math.hypot(e.clientX-downX, e.clientY-downY);
      if(moved < 6){
        const hitId = pickNodeAt(e.clientX, e.clientY);
        if(hitId) selectNode(hitId);
        else handleBackgroundTap();
      }
    }
    mode = null; draggedNodeId = null;
    pinchOccurred = false;
  }
}
renderer.domElement.addEventListener('pointerup', endPointer);
renderer.domElement.addEventListener('pointercancel', endPointer);

renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  targetCamZ = null;
  camera.position.z = clampCamZ(camera.position.z + (e.deltaY>0 ? 26 : -26));
}, {passive:false});

window.addEventListener('resize', () => {
  camera.aspect = host.clientWidth/host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
});

function selectNode(id){
  selectedId = id; editMode = false;
  updateSelectionVisuals();
  openPanel(id);
}

function openPanel(id){
  const node = nodeById(id);
  if(!node) return;
  panelRefreshId = id;
  const panel = document.getElementById('panel');
  panel.classList.add('open');
  document.getElementById('panelTitle').textContent = editMode ? '编辑节点' : node.title;

  if(editMode){
    document.getElementById('panelBody').innerHTML = `
      <div class="field"><label>结论（标题）</label><input type="text" id="editTitle" value="${node.title.replace(/"/g,'&quot;')}"></div>
      <div class="field"><label>类型</label>
        <select id="editType">${Object.keys(TYPE_LABEL).map(t=>`<option value="${t}" ${t===node.type?'selected':''}>${TYPE_LABEL[t]}</option>`).join('')}</select>
      </div>
      <div class="field"><label>最小推理过程</label><textarea id="editReasoning">${node.reasoning||''}</textarea></div>
    `;
    document.getElementById('panelActions').innerHTML = `
      <button class="btn primary" id="saveEdit">保存修改</button>
      <button class="btn ghost" id="cancelEdit">取消</button>
    `;
    document.getElementById('saveEdit').addEventListener('click', async () => {
      const title = document.getElementById('editTitle').value.trim() || node.title;
      const nodeType = document.getElementById('editType').value;
      const reasoning = document.getElementById('editReasoning').value;
      await cmdEditNode(store, { nodeId: id, title, nodeType, reasoning });
      editMode = false;
      showToast('节点已更新，若类型变化会缓慢漂移至对应层空间。');
    });
    document.getElementById('cancelEdit').addEventListener('click', () => { editMode=false; openPanel(id); });
    return;
  }

  const typeColor = TYPE_COLOR_HEX[node.type];
  const statusColor = STATUS_COLOR_HEX[node.status];
  const premises = node.premises.map(pid => {
    const p = nodeById(pid);
    return p ? `<div class="chip" data-jump="${pid}">${p.title.slice(0,20)}${p.title.length>20?'…':''}</div>` : '';
  }).join('') || '<div class="chip empty">无前置（公理层或独立节点）</div>';
  const deps = dependentsOf(id).map(d =>
    `<div class="chip" data-jump="${d.id}">${d.title.slice(0,20)}${d.title.length>20?'…':''}</div>`
  ).join('') || '<div class="chip empty">暂无下游依赖节点</div>';
  const twins = twinsOf(id);
  const twinHtml = twins.length ? `
    <div class="field">
      <label>孪生证明（同一结论："${node.sharedTitle||''}"）</label>
      <div class="chip-list">${twins.map(t=>`<div class="chip" data-jump="${t.id}">${t.title}</div>`).join('')}</div>
    </div>` : '';

  document.getElementById('panelBody').innerHTML = `
    <div class="badge-row">
      <div class="badge" style="color:${typeColor};border-color:${typeColor}66;">${TYPE_LABEL[node.type]}</div>
      <div class="badge" style="color:${statusColor};border-color:${statusColor}66;">${STATUS_LABEL[node.status]}</div>
      <div class="badge" style="color:var(--brass);border-color:var(--brass-dim);">${LAYER_LABEL[node.layer]}</div>
    </div>
    <div class="field">
      <label>AI 判断掌握程度（模拟，实际应基于历史聊天自动识别）</label>
      <div class="mastery-display" id="masteryDisplay">${MASTERY_LABEL[node.mastery]}</div>
      <div class="mastery-demo-controls">
        <div class="chip ${node.mastery==='none'?'active':''}" data-mastery="none">未接触</div>
        <div class="chip ${node.mastery==='touched'?'active':''}" data-mastery="touched">接触过</div>
        <div class="chip ${node.mastery==='mastered'?'active':''}" data-mastery="mastered">完全掌握</div>
      </div>
      <div class="note-small" style="text-align:left;margin-top:6px;">演示环境无法接入真实聊天记录，此处按钮为手动模拟 AI 判断结果。</div>
    </div>
    <div class="field"><label>最小推理过程</label><div class="val">${node.reasoning || '（未填写）'}</div></div>
    <div class="field"><label>前置知识点（依赖边）</label><div class="chip-list">${premises}</div></div>
    <div class="field"><label>下游依赖节点</label><div class="chip-list">${deps}</div></div>
    ${twinHtml}
  `;

  document.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => selectNode(el.getAttribute('data-jump'))));
  document.querySelectorAll('[data-mastery]').forEach(el => el.addEventListener('click', async () => {
    await cmdSetMastery(store, { nodeId: id, mastery: el.getAttribute('data-mastery') });
  }));

  const actions = document.getElementById('panelActions');
  let html = '<div class="action-grid">';
  html += `<button class="btn ghost" id="btnEditNode">✎ 编辑节点</button>`;
  html += `<button class="btn ghost" id="btnDeriveNode">↳ 推理新节点</button>`;
  html += '</div>';
  if(node.status !== 'falsified' && node.status !== 'suspended'){
    html += `<button class="btn danger" id="btnFalsify">⚠ 否定该节点（级联悬置下游）</button>`;
  }
  if(node.status === 'suspended'){
    html += `<button class="btn confirm" id="btnResolve">✓ 标记重新验证通过</button>`;
    html += `<div class="note-small">实际协议中：全网公告悬置节点，先到先得抢验证资格，需通过逻辑/证据校验方可解除，此处为手动模拟。</div>`;
  }
  actions.innerHTML = html;

  document.getElementById('btnEditNode').addEventListener('click', () => { editMode=true; openPanel(id); });
  document.getElementById('btnDeriveNode').addEventListener('click', () => openAddModal(id));
  const bf=document.getElementById('btnFalsify'); if(bf) bf.addEventListener('click', () => invalidateNode(id));
  const br=document.getElementById('btnResolve'); if(br) br.addEventListener('click', () => resolveNodeAction(id));
}

document.getElementById('panelClose').addEventListener('click', () => {
  document.getElementById('panel').classList.remove('open');
  selectedId = null; editMode = false; panelRefreshId = null;
  updateSelectionVisuals();
});

async function invalidateNode(id){
  const node = nodeById(id);
  const events = await cmdFalsifyNode(store, projection, { nodeId: id });
  const suspendedCount = events.length - 1;
  showToast(`已标记「${node.title.slice(0,14)}…」为已证伪，级联悬置 ${suspendedCount} 个下游节点。`);
}

async function resolveNodeAction(id){
  const node = nodeById(id);
  await cmdResolveNode(store, { nodeId: id });
  showToast(`「${node.title.slice(0,14)}…」已标记为重新验证通过，若类型符合准入条件将缓慢回归内/中层空间。`);
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>t.classList.remove('show'), 4400);
}

const modalOverlay = document.getElementById('modalOverlay');
let prefillPremise = null;

function renderPremiseList(){
  document.getElementById('fPremises').innerHTML = nodes.map(n => `
    <label class="premise-item">
      <input type="checkbox" value="${n.id}" ${prefillPremise===n.id?'checked':''}> ${n.title.slice(0,32)}${n.title.length>32?'…':''}
    </label>`).join('');
}
document.getElementById('aiAddBtn').addEventListener('click', () => openAddModal(null));
function openAddModal(fromNodeId){
  prefillPremise = fromNodeId;
  document.getElementById('fTitle').value='';
  document.getElementById('fReasoning').value='';
  document.getElementById('fType').value='fact';
  document.getElementById('fLogicConfirm').checked = false;
  document.getElementById('modalSubmit').disabled = true;
  const hint = document.getElementById('modalHint');
  if(fromNodeId){
    const src = nodeById(fromNodeId);
    document.getElementById('modalTitle').textContent = '推理新节点';
    hint.style.display='block';
    hint.textContent = `将默认以「${src.title}」作为前置知识点`;
  } else {
    document.getElementById('modalTitle').textContent = '提交新知识节点';
    hint.style.display='none';
  }
  renderPremiseList();
  modalOverlay.classList.add('show');
}
document.getElementById('fLogicConfirm').addEventListener('change', e => {
  document.getElementById('modalSubmit').disabled = !e.target.checked;
});
document.getElementById('modalClose').addEventListener('click', ()=>modalOverlay.classList.remove('show'));
document.getElementById('modalCancel').addEventListener('click', ()=>modalOverlay.classList.remove('show'));
modalOverlay.addEventListener('click', e => { if(e.target===modalOverlay) modalOverlay.classList.remove('show'); });

document.getElementById('modalSubmit').addEventListener('click', async () => {
  const title = document.getElementById('fTitle').value.trim();
  if(!title){ showToast('请填写节点结论标题。'); return; }
  if(!document.getElementById('fLogicConfirm').checked){ showToast('请先确认符合逻辑三大基本定律。'); return; }
  const nodeType = document.getElementById('fType').value;
  const reasoning = document.getElementById('fReasoning').value.trim();
  const premises = Array.from(document.querySelectorAll('#fPremises input:checked')).map(el=>el.value);
  const nodeId = 'n' + Math.random().toString(36).slice(2,9);
  await cmdCreateNode(store, { nodeId, title, nodeType, reasoning, premises });
  modalOverlay.classList.remove('show');
  showToast(`节点已提交，全局唯一 ID：${nodeId}，状态「等待验证」，落入外层空间。`);
});

const aiInput = document.getElementById('aiInput');
const aiResults = document.getElementById('aiResults');
const aiSend = document.getElementById('aiSend');

function runSearch(){
  const q = aiInput.value.trim().toLowerCase();
  if(!q){ aiResults.classList.remove('show'); return; }
  const matches = nodes.filter(n => n.title.toLowerCase().includes(q) || (n.reasoning||'').toLowerCase().includes(q));
  aiResults.innerHTML = matches.length===0
    ? '<div class="search-item" style="color:var(--ink-faint)">未找到匹配的知识节点</div>'
    : matches.slice(0,8).map(n => `<div class="search-item" data-id="${n.id}"><span>${n.title}</span><small>${TYPE_LABEL[n.type]} · ${STATUS_LABEL[n.status]}</small></div>`).join('');
  aiResults.classList.add('show');
}
aiInput.addEventListener('input', runSearch);
aiInput.addEventListener('focus', runSearch);
aiInput.addEventListener('keydown', e => { if(e.key==='Enter') jumpToFirstMatch(); });
aiSend.addEventListener('click', jumpToFirstMatch);
function jumpToFirstMatch(){
  const q = aiInput.value.trim().toLowerCase();
  if(!q) return;
  const match = nodes.find(n => n.title.toLowerCase().includes(q) || (n.reasoning||'').toLowerCase().includes(q));
  if(match) jumpTo(match.id);
  aiResults.classList.remove('show');
}
aiResults.addEventListener('click', e => {
  const item = e.target.closest('.search-item');
  if(!item || !item.dataset.id) return;
  jumpTo(item.dataset.id);
  aiResults.classList.remove('show'); aiInput.value='';
});
document.addEventListener('click', e => { if(!e.target.closest('.ai-bar-inner')) aiResults.classList.remove('show'); });

function jumpTo(id){
  const node = nodeById(id);
  const dir = node.pos.clone().normalize();
  const safeDir = dir.lengthSq()>0 ? dir : new THREE.Vector3(0,0,1);
  const quat = new THREE.Quaternion().setFromUnitVectors(safeDir, new THREE.Vector3(0,0,1));
  worldGroup.quaternion.copy(quat);
  selectNode(id);
}

const accountOverlay = document.getElementById('accountOverlay');
document.getElementById('avatarBtn').addEventListener('click', () => {
  document.getElementById('statRep').textContent = '132';
  document.getElementById('statLit').textContent = nodes.filter(n=>n.mastery!=='none').length;
  document.getElementById('statContrib').textContent = nodes.filter(n=>n.status==='pending').length + ' (待验证中)';
  accountOverlay.classList.add('show');
});
document.getElementById('accountClose').addEventListener('click', ()=>accountOverlay.classList.remove('show'));
accountOverlay.addEventListener('click', e => { if(e.target===accountOverlay) accountOverlay.classList.remove('show'); });

document.getElementById('btnPersonal').addEventListener('click', () => {
  hideUntouched = !hideUntouched;
  document.getElementById('btnPersonal').classList.toggle('active', hideUntouched);
  applyHideUntouched();
  showToast(hideUntouched ? '已隐藏未接触的知识节点及相关连线' : '已恢复显示全部节点');
});

const settingsOverlay = document.getElementById('settingsOverlay');
document.getElementById('btnSettings').addEventListener('click', () => settingsOverlay.classList.add('show'));
document.getElementById('settingsClose').addEventListener('click', () => settingsOverlay.classList.remove('show'));
settingsOverlay.addEventListener('click', e => { if(e.target===settingsOverlay) settingsOverlay.classList.remove('show'); });

document.getElementById('setNodeRadius').addEventListener('input', e => {
  nodeRadiusMM = parseFloat(e.target.value);
  document.getElementById('setNodeRadiusVal').textContent = nodeRadiusMM.toFixed(1)+'mm';
  nodes.forEach(updateNodeAppearance);
});
document.getElementById('setLabelSize').addEventListener('input', e => {
  document.documentElement.style.setProperty('--label-size', e.target.value+'px');
  document.getElementById('setLabelSizeVal').textContent = e.target.value+'px';
});
document.getElementById('setLabelColor').addEventListener('input', e => {
  document.documentElement.style.setProperty('--label-color', e.target.value);
});
document.getElementById('setLabelFont').addEventListener('change', e => {
  document.documentElement.style.setProperty('--label-font', e.target.value);
});
document.getElementById('setLabelBrightness').addEventListener('input', e => {
  labelBrightness = e.target.value/100;
  document.getElementById('setLabelBrightnessVal').textContent = e.target.value+'%';
});
document.getElementById('depthLimit').addEventListener('input', e => {
  const v = e.target.value ? parseInt(e.target.value) : null;
  setCascadeDepthLimit(v);
});

async function seed(){
  await cmdCreateNode(store, {nodeId:'n1', title:'同一律', nodeType:'axiom', reasoning:'逻辑基础公理，长期稳定、无法继续向下证明，经准入规则纳入公理层。', premises:[]});
  await cmdSetMastery(store, {nodeId:'n1', mastery:'mastered'});
  await cmdResolveNode(store, {nodeId:'n1'});

  await cmdCreateNode(store, {nodeId:'n2', title:'排中律', nodeType:'axiom', reasoning:'逻辑基础公理，与同一律、矛盾律共同构成经典逻辑地基。', premises:[]});
  await cmdSetMastery(store, {nodeId:'n2', mastery:'touched'});
  await cmdResolveNode(store, {nodeId:'n2'});

  await cmdCreateNode(store, {nodeId:'n3', title:'质数的定义', nodeType:'definition', reasoning:'仅能被 1 和自身整除的大于 1 的自然数。基于同一律确立的稳定定义，长期无异议。', premises:['n1']});
  await cmdSetMastery(store, {nodeId:'n3', mastery:'mastered'});
  await cmdResolveNode(store, {nodeId:'n3'});

  await cmdCreateNode(store, {nodeId:'n4', title:'水的沸点', nodeType:'fact', reasoning:'标准大气压下纯水沸点为 100°C，实验反复验证的经验事实。', premises:[]});
  await cmdSetMastery(store, {nodeId:'n4', mastery:'touched'});
  await cmdResolveNode(store, {nodeId:'n4'});

  await cmdCreateNode(store, {nodeId:'n5', title:'勾股定理', nodeType:'theorem', reasoning:'直角三角形两直角边平方和等于斜边平方。欧几里得《几何原本》给出的经典演绎证明，基于同一律与排中律。', premises:['n1','n2']});
  await cmdSetMastery(store, {nodeId:'n5', mastery:'mastered'});
  await cmdResolveNode(store, {nodeId:'n5'});

  await cmdCreateNode(store, {nodeId:'n6', title:'反证法证明', nodeType:'theorem', reasoning:'假设质数有限，构造新数导出矛盾，证明质数数量无穷。', premises:['n3']});
  await cmdSetMastery(store, {nodeId:'n6', mastery:'mastered'});
  await cmdResolveNode(store, {nodeId:'n6'});

  await cmdCreateNode(store, {nodeId:'n15', title:'欧拉乘积证法', nodeType:'theorem', reasoning:'通过欧拉乘积公式 ∏(1-p⁻¹)⁻¹ 的发散性证明质数无穷，与反证法殊途同归，是同一结论的独立证明路径。', premises:['n3']});
  await cmdSetMastery(store, {nodeId:'n15', mastery:'touched'});
  await cmdResolveNode(store, {nodeId:'n15'});

  await cmdCreateNode(store, {nodeId:'n7', title:'黎曼猜想', nodeType:'hypothesis', reasoning:'非平凡零点实部均为 1/2。尚无完整证明或证伪，悬置状态本身是准确的表达，而非系统缺陷。', premises:['n3']});
  await cmdSetMastery(store, {nodeId:'n7', mastery:'touched'});
  await cmdSuspendNode(store, {nodeId:'n7'});

  await cmdCreateNode(store, {nodeId:'n8', title:'AGI 时间预测', nodeType:'prediction', reasoning:'预测 2035 年可实现通用人工智能。不存在可验证的逻辑链条，悬置等待未来事件校验，校验结果计入提交者声誉。', premises:[]});
  await cmdSuspendNode(store, {nodeId:'n8'});

  await cmdCreateNode(store, {nodeId:'n9', title:'自由市场效率观点', nodeType:'opinion', reasoning:'自由市场比计划经济更有效率。规范性/经验混合命题，无法逻辑裁定，采用加权投票+悬置并展示正反证据。', premises:[]});
  await cmdSetMastery(store, {nodeId:'n9', mastery:'touched'});
  await cmdDisputeNode(store, {nodeId:'n9'});

  await cmdCreateNode(store, {nodeId:'n10', title:'个体自由优先', nodeType:'value', reasoning:'个体自由优先于集体效率。纯价值判断，协议不裁定对错，仅呈现论据双方。', premises:[]});
  await cmdDisputeNode(store, {nodeId:'n10'});

  await cmdCreateNode(store, {nodeId:'n11', title:'LK-99 超导声称', nodeType:'fact', reasoning:'论文声称 LK-99 材料在常压常温下具有超导性。2023 年论文声称发现常温常压超导现象，后经多个独立实验室复现失败、机制被重新解释，节点被标记为已证伪。', premises:[]});
  await cmdSetMastery(store, {nodeId:'n11', mastery:'touched'});

  await cmdCreateNode(store, {nodeId:'n12', title:'无损耗输电推论', nodeType:'theorem', reasoning:'若 LK-99 超导属实，可实现无损耗输电网络。完全依赖 n11 成立，前提证伪后本节点自动进入悬置。', premises:['n11']});
  await cmdCreateNode(store, {nodeId:'n13', title:'数据中心节能推论', nodeType:'prediction', reasoning:'LK-99 应用可大幅降低数据中心能耗。依赖 n12 的工程可行性，属于二级下游推论。', premises:['n12']});
  await cmdCreateNode(store, {nodeId:'n14', title:'电网投资推论', nodeType:'opinion', reasoning:'LK-99 产业化将重塑全球电网基建投资方向。依赖 n12，属于二级下游的产业判断。', premises:['n12']});

  await cmdFalsifyNode(store, projection, {nodeId:'n11'});
}

seed().then(() => { renderLoop(); });

(window).__debug = { store, projection };
