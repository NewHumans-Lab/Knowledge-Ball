import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';

const sceneSource = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');

assert(sceneSource.includes('labelAnchor: THREE.Object3D;'), 'each rendered node must own a real 3D label anchor');
assert(sceneSource.includes('const labelAnchor = new THREE.Object3D();'), 'node creation must allocate the 3D label anchor once');
assert(sceneSource.includes('group.add(shell, point, dot, labelAnchor);'), 'sphere and label anchor must share the exact same node transform hierarchy');
assert(sceneSource.includes('record.labelAnchor.position.set(0, radius * compensation, 0);'), 'label anchor must be placed exactly one rendered local radius above the sphere center');
assert(sceneSource.includes('record.labelAnchor.getWorldPosition(labelAnchorWorld);'), 'label placement must project the anchor world position produced by the shared scene graph');
assert(!sceneSource.includes('cameraUp.set('), 'label placement must no longer synthesize a separate camera-up offset');
assert(!sceneSource.includes('addScaledVector(cameraUp'), 'label placement must not reconstruct sphere contact outside the node transform hierarchy');

const camera = new THREE.PerspectiveCamera(50, 390 / 844, .5, 8000);
camera.position.set(0, 0, 640);
camera.updateProjectionMatrix();

const worldGroup = new THREE.Group();
worldGroup.scale.setScalar(2.4);
worldGroup.rotation.set(.37, -.62, .11);
const nodesGroup = new THREE.Group();
worldGroup.add(nodesGroup);

const radius = 7.2;
const graphZoom = worldGroup.scale.x;
const compensatedRadius = radius / graphZoom;

for (const position of [
  new THREE.Vector3(-55, 110, 35),
  new THREE.Vector3(20, 0, -15),
  new THREE.Vector3(70, -125, 45),
]) {
  const group = new THREE.Group();
  group.position.copy(position);
  nodesGroup.add(group);

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16));
  shell.scale.setScalar(compensatedRadius);
  group.add(shell);

  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, compensatedRadius, 0);
  group.add(labelAnchor);

  worldGroup.updateMatrixWorld(true);

  const anchorWorld = labelAnchor.getWorldPosition(new THREE.Vector3());
  const exactSphereContactWorld = new THREE.Vector3(0, compensatedRadius, 0).applyMatrix4(group.matrixWorld);
  assert(anchorWorld.distanceTo(exactSphereContactWorld) < 1e-10, `3D anchor must remain exactly on the sphere surface for node y=${position.y}`);

  const anchorProjected = anchorWorld.clone().project(camera);
  const contactProjected = exactSphereContactWorld.clone().project(camera);
  assert(anchorProjected.distanceTo(contactProjected) < 1e-12, `shared perspective projection must preserve contact for node y=${position.y}`);

  nodesGroup.remove(group);
}

console.log('Label spatial-anchor regression tests passed');
