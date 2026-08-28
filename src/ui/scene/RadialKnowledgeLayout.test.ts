import assert from 'node:assert/strict';
import {
  applyDeterministic5RLayout, generateIcosahedralGrid, getLastLayoutDiagnostics,
  ICOSAHEDRON_FACES, KNOWLEDGE_BALL_RADIUS, LAYOUT_UNIT, selectSubdivisionFrequency,
  type LayoutNode,
} from './Deterministic5RLayout';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});
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
console.log('Icosahedral spherical grid geometry, authority, atomic occupancy, ordering, anchoring and determinism checks passed.');
