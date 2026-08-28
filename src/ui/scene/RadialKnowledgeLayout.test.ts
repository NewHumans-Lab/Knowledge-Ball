import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyDeterministic5RLayout, computeSemanticBoundaries, generateIcosahedralGrid, getLastLayoutDiagnostics,
  countLayerCrossings, ICOSAHEDRON_FACES, KNOWLEDGE_BALL_RADIUS, LAYOUT_UNIT, selectSubdivisionFrequency,
  type LayoutNode,
} from './Deterministic5RLayout';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});
const chain=(prefix:string,length:number,layer:LayoutNode['declaredLayer']):LayoutNode[]=>{
  if(length<1)return [];
  const result:LayoutNode[]=[node(`${prefix}-k0`,[],'fact',layer)];
  for(let i=1;i<length;i++){
    const reasoningId=`${prefix}-r${i}`;
    result.push(node(reasoningId,[`${prefix}-k${i-1}`],'reasoning',layer));
    result.push(node(`${prefix}-k${i}`,[reasoningId],'fact',layer));
  }
  return result;
};
assert.equal(ICOSAHEDRON_FACES.length,20,'the ISG has exactly twenty parent faces');
const base=generateIcosahedralGrid(LAYOUT_UNIT,1);
assert.equal(base.vertices.length,12,'shared parent-face corners canonicalize to twelve physical cells');
assert(base.vertices.every(v=>Math.abs(v.length()-LAYOUT_UNIT)<1e-8),'all cells lie on their shell');
assert.equal(base.degrees.filter(d=>d===5).length,12,'base topology has twelve pentagonal defects');
const dense=generateIcosahedralGrid(5*LAYOUT_UNIT);
assert.equal(dense.degrees.filter(d=>d===5).length,12,'every subdivision retains exactly twelve pentagonal defects');
assert(dense.degrees.every(d=>d===5||d===6),'all ordinary cells have topological degree six');
assert(dense.nearestNeighborDistance>=LAYOUT_UNIT-1e-7,'nearest neighbours respect 5R');
const next=generateIcosahedralGrid(5*LAYOUT_UNIT,selectSubdivisionFrequency(5*LAYOUT_UNIT)+1,'illegal',false);
assert(next.nearestNeighborDistance<LAYOUT_UNIT,'the selected frequency is the densest legal subdivision');
assert(generateIcosahedralGrid(8*LAYOUT_UNIT).vertices.length>dense.vertices.length,'larger shells expose more cells');

const minimalSemantic=computeSemanticBoundaries([node('semantic-inner'),node('semantic-middle',[],'fact','middle')]);
assert.equal(minimalSemantic.cyanBlue,LAYOUT_UNIT,'one Cyan knowledge shell needs exactly one 5R unit');
assert.equal(minimalSemantic.bluePurple-minimalSemantic.cyanBlue,LAYOUT_UNIT,'Blue thickness is demand-driven; the old fixed 10R semantic gap is removed');

const independentBase=computeSemanticBoundaries([
  ...chain('independent-inner',2,'inner'),
  ...chain('independent-middle',2,'middle'),
  ...chain('independent-outer',2,'outer'),
]);
const longerBlue=computeSemanticBoundaries([
  ...chain('independent-inner',2,'inner'),
  ...chain('independent-middle',6,'middle'),
  ...chain('independent-outer',2,'outer'),
]);
assert.equal(longerBlue.cyanBlue,independentBase.cyanBlue,'a longer Blue chain must not enlarge the Cyan radius');
assert(longerBlue.bluePurple-longerBlue.cyanBlue>independentBase.bluePurple-independentBase.cyanBlue,'Blue thickness follows its own longest-chain demand');
const longerCyan=computeSemanticBoundaries([
  ...chain('independent-inner',6,'inner'),
  ...chain('independent-middle',2,'middle'),
  ...chain('independent-outer',2,'outer'),
]);
assert(longerCyan.cyanBlue>independentBase.cyanBlue,'Cyan radius follows its own longest-chain demand');
assert.equal(longerCyan.bluePurple-longerCyan.cyanBlue,independentBase.bluePurple-independentBase.cyanBlue,'Cyan growth must not change Blue demand thickness');
const longerPurple=computeSemanticBoundaries([
  ...chain('independent-inner',2,'inner'),
  ...chain('independent-middle',2,'middle'),
  ...chain('independent-outer',30,'outer'),
]);
assert.deepEqual(longerPurple,independentBase,'Purple remains outward-unbounded and cannot push either inner semantic boundary');

const middleWidth12=computeSemanticBoundaries([
  node('width-inner'),
  ...Array.from({length:12},(_,i)=>node(`width-middle-${i}`,[],'fact','middle')),
]);
const middleWidth13=computeSemanticBoundaries([
  node('width-inner'),
  ...Array.from({length:13},(_,i)=>node(`width-middle-${i}`,[],'fact','middle')),
]);
assert.equal(middleWidth12.cyanBlue,middleWidth13.cyanBlue,'Blue capacity pressure must not affect Cyan');
assert(middleWidth13.bluePurple-middleWidth13.cyanBlue>middleWidth12.bluePurple-middleWidth12.cyanBlue,'non-Reasoning peak depth width expands only the affected Semantic layer');
const reasoningNoise=computeSemanticBoundaries([
  node('noise-inner'),node('noise-middle',[],'fact','middle'),
  ...Array.from({length:1000},(_,i)=>node(`noise-r-${i}`,[],'reasoning',i%2?'middle':'inner')),
]);
assert.deepEqual(reasoningNoise,minimalSemantic,'Reasoning count must never affect Semantic shell radius or capacity');

const fixture=():LayoutNode[]=>[
 node('a'),node('b'),node('r1',['a','b'],'reasoning'),node('c',['r1'],'theorem','middle'),
 node('r2',['c'],'reasoning'),node('d',['r2'],'hypothesis','outer'),node('standalone-z'),
];
const first=fixture();applyDeterministic5RLayout(first);const diag=getLastLayoutDiagnostics()!;
const knowledge=first.filter(n=>n.type!=='reasoning');
assert.equal(diag.occupiedCells.size,knowledge.length,'reasoning consumes no occupancy cell');
assert(knowledge.every(n=>n.address&&diag.grids.get(n.address.shellID)?.vertices[n.address.cellID]),'knowledge authority is a legal shell/cell address');
assert.equal(new Set(knowledge.map(n=>`${n.address!.shellID}:${n.address!.cellID}`)).size,knowledge.length,'authoritative addresses are unique');
for(let i=0;i<knowledge.length;i++)for(let j=i+1;j<knowledge.length;j++)assert(knowledge[i]!.pos!.distanceTo(knowledge[j]!.pos!)>=LAYOUT_UNIT-1e-7,'all cross-shell and same-shell pairs satisfy 5R');
for(const r of first.filter(n=>n.type==='reasoning'))assert.equal(r.address,undefined,'reasoning has no ISG address');
assert(diag.placementOrder.indexOf('a')<diag.placementOrder.indexOf('standalone-z'),'complex components precede standalone knowledge');
assert(Math.abs(first.find(n=>n.id==='d')!.pos!.length()-diag.boundaries.bluePurple)<1e-7,'innermost Purple knowledge anchors to a boundary grid cell');
assert(Math.abs(first.find(n=>n.id==='a')!.pos!.length()-diag.boundaries.cyanBlue)<1e-7,'Cyan start anchors to the Cyan/Blue boundary grid');
const addresses=[...diag.addresses].map(([id,a])=>[id,a.shellID,a.cellID]);const xyz=first.map(n=>n.pos?.toArray());
const second=fixture();applyDeterministic5RLayout(second);assert.deepEqual([...getLastLayoutDiagnostics()!.addresses].map(([id,a])=>[id,a.shellID,a.cellID]),addresses);assert.deepEqual(second.map(n=>n.pos?.toArray()),xyz,'identical input derives identical XYZ');

const deepChain:LayoutNode[]=[node('k0')];
for(let i=1;i<5;i++){deepChain.push(node(`chain-r${i}`,[`k${i-1}`],'reasoning'));deepChain.push(node(`k${i}`,[`chain-r${i}`],'fact',i===4?'outer':i>1?'middle':'inner'))}
applyDeterministic5RLayout(deepChain);const deepDiag=getLastLayoutDiagnostics()!;
assert(deepChain.filter(n=>n.type!=='reasoning').every(n=>n.pos!.length()>0),'real five-Knowledge chain depth always yields positive radii');
assert(Math.abs(deepChain.find(n=>n.id==='k4')!.pos!.length()-deepDiag.boundaries.bluePurple)<1e-7,'innermost Purple chain node anchors to the legal Blue/Purple boundary shell');

const crossingPositions=new Map([
  ['p1',new THREE.Vector3(-1,-1,2)],['p2',new THREE.Vector3(1,-1,2)],
  ['c1',new THREE.Vector3(-1,1,3)],['c2',new THREE.Vector3(1,1,3)],
]);
assert.equal(countLayerCrossings(crossingPositions,[['p1','c2'],['p2','c1']]),1,'crossing metric measures crossed relations rather than returning a placeholder');
assert.equal(countLayerCrossings(crossingPositions,[['p1','c1'],['p2','c2']]),0,'crossing metric distinguishes the lower-crossing arrangement');

const lineage:LayoutNode[]=[
  {...node('topic-current'),lineage:{topicId:'topic',proposal:'new',role:'current',rank:0}},
  {...node('topic-history'),hidden:true,lineage:{topicId:'topic',proposal:'optimization',role:'history',rank:1}},
  {...node('topic-opposition'),lineage:{topicId:'topic',proposal:'opposition',role:'opposition',rank:1,reasoningSide:'opposition'}},
];
applyDeterministic5RLayout(lineage);const lineageDiag=getLastLayoutDiagnostics()!;
assert(lineage.every(n=>n.address&&lineageDiag.grids.get(n.address.shellID)?.vertices[n.address.cellID]),'visible lineage Knowledge uses legal authoritative ISG cells');
for(let i=0;i<lineage.length;i++)for(let j=i+1;j<lineage.length;j++)assert(lineage[i]!.pos!.distanceTo(lineage[j]!.pos!)>=LAYOUT_UNIT-1e-7,'lineage Knowledge participates in global 5R spacing');
assert(lineageDiag.gridBuildCount<40,'one layout run caches repeated shell geometry/frequency requests');
console.log('Icosahedral spherical grid geometry, independent Semantic shell sizing, authority, atomic occupancy, ordering, anchoring and determinism checks passed.');
