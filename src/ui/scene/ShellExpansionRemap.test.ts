import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyDeterministic5RLayout,
  getLastLayoutDiagnostics,
  LAYOUT_UNIT,
  type IcosahedralGrid,
  type LayoutDiagnostics,
  type LayoutNode,
} from './Deterministic5RLayout';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});
const chain=(prefix:string,length:number,layer:LayoutNode['declaredLayer']):LayoutNode[]=>{
  const result:LayoutNode[]=[node(`${prefix}-k0`,[],'fact',layer)];
  for(let i=1;i<length;i++){
    const reasoningId=`${prefix}-r${i}`;
    result.push(node(reasoningId,[`${prefix}-k${i-1}`],'reasoning',layer));
    result.push(node(`${prefix}-k${i}`,[reasoningId],'fact',layer));
  }
  return result;
};
const positions=(nodes:readonly LayoutNode[])=>new Map(nodes.filter(n=>n.type!=='reasoning').map(n=>[n.id,n.pos!.clone()]));
const componentOf=(diag:LayoutDiagnostics,id:string)=>[...diag.componentOrders].find(([,ids])=>ids.includes(id))?.[0]??id;
const nearestCell=(grid:IcosahedralGrid,ray:THREE.Vector3)=>grid.vertices.map((v,i)=>({i,d:v.clone().normalize().dot(ray)})).sort((a,b)=>b.d-a.d||a.i-b.i)[0]!.i;
const assertMappedAlongOldRay=(old:ReadonlyMap<string,THREE.Vector3>,nodes:readonly LayoutNode[],diag:LayoutDiagnostics,id:string)=>{
  const current=nodes.find(n=>n.id===id)!;
  const grid=diag.grids.get(current.address!.shellID)!;
  assert.equal(current.address!.cellID,nearestCell(grid,old.get(id)!.clone().normalize()),`${id} must map to the nearest cell on its old radial ray; expansion may not search a new chain direction`);
};
const assertGlobalSpacing=(nodes:readonly LayoutNode[],diag:LayoutDiagnostics)=>{
  const knowledge=nodes.filter(n=>n.type!=='reasoning');
  assert.equal(diag.occupiedCells.size,knowledge.length,'atomic occupancy rebuild contains every Knowledge node exactly once');
  assert.equal(new Set(knowledge.map(n=>`${n.address!.shellID}:${n.address!.cellID}`)).size,knowledge.length,'atomic occupancy has no duplicate authoritative address');
  for(let i=0;i<knowledge.length;i++)for(let j=i+1;j<knowledge.length;j++)assert(knowledge[i]!.pos!.distanceTo(knowledge[j]!.pos!)>=LAYOUT_UNIT-1e-7,'outward remap keeps global 5R spacing');
};

// Cyan/Blue boundary expansion: only a purely Cyan component stays fixed. Any component containing Blue or Purple moves as one unit.
const cyanBase:LayoutNode[]=[
  node('expand-cyan-only'),
  node('expand-blue-only',[],'fact','middle'),
  node('expand-purple-only',[],'fact','outer'),
  node('expand-mixed-cyan'),
  node('expand-mixed-r',['expand-mixed-cyan'],'reasoning'),
  node('expand-mixed-blue',['expand-mixed-r'],'fact','middle'),
];
applyDeterministic5RLayout(cyanBase);
const cyanBefore=getLastLayoutDiagnostics()!,cyanOld=positions(cyanBase);
const cyanExpanded:LayoutNode[]=[
  node('expand-cyan-only'),
  node('expand-blue-only',[],'fact','middle'),
  node('expand-purple-only',[],'fact','outer'),
  node('expand-mixed-cyan'),
  node('expand-mixed-r',['expand-mixed-cyan'],'reasoning'),
  node('expand-mixed-blue',['expand-mixed-r'],'fact','middle'),
  ...chain('expand-cyan-growth',2,'inner'),
];
applyDeterministic5RLayout(cyanExpanded);
const cyanAfter=getLastLayoutDiagnostics()!;
assert.equal(cyanAfter.boundaries.cyanBlue-cyanBefore.boundaries.cyanBlue,LAYOUT_UNIT,'Cyan/Blue boundary expands exactly one 5R step');
assert.equal((cyanAfter.boundaries.bluePurple-cyanAfter.boundaries.cyanBlue)-(cyanBefore.boundaries.bluePurple-cyanBefore.boundaries.cyanBlue),0,'Cyan growth does not enlarge Blue thickness');
assert(cyanExpanded.find(n=>n.id==='expand-cyan-only')!.pos!.equals(cyanOld.get('expand-cyan-only')!),'pure Cyan Knowledge does not move when the inner boundary expands');
for(const id of ['expand-blue-only','expand-purple-only','expand-mixed-cyan','expand-mixed-blue']){
  const current=cyanExpanded.find(n=>n.id===id)!;
  assert(Math.abs(current.pos!.length()-cyanOld.get(id)!.length()-LAYOUT_UNIT)<1e-7,`${id} moves outward exactly 5R`);
  assertMappedAlongOldRay(cyanOld,cyanExpanded,cyanAfter,id);
  const component=componentOf(cyanAfter,id);
  assert.equal(cyanAfter.componentOptimizationPasses.get(component),0,'boundary remap must not rerun chain optimization');
  assert.equal(cyanAfter.directionSwitchCounts.get(component),0,'boundary remap must not search or switch chain direction');
}
const pureCyanComponent=componentOf(cyanAfter,'expand-cyan-only');
assert.equal(cyanAfter.boundaryShiftByComponent.get(pureCyanComponent),0,'pure Cyan component receives zero inner-boundary shift');
const mixedInnerComponent=componentOf(cyanAfter,'expand-mixed-cyan');
assert.equal(cyanAfter.boundaryShiftByComponent.get(mixedInnerComponent),LAYOUT_UNIT,'a chain containing Blue moves as one component, including its Cyan member');
assert(cyanAfter.boundaryRemappedComponents.has(mixedInnerComponent),'mixed Cyan/Blue chain is recorded as one boundary remap');
assertGlobalSpacing(cyanExpanded,cyanAfter);

// Blue/Purple boundary expansion: only components containing Purple move. Pure Cyan and pure Blue remain fixed.
const purpleBase:LayoutNode[]=[
  node('outer-cyan-only'),
  node('outer-blue-only',[],'fact','middle'),
  node('outer-purple-only',[],'fact','outer'),
  node('outer-mixed-blue',[],'fact','middle'),
  node('outer-mixed-r',['outer-mixed-blue'],'reasoning','middle'),
  node('outer-mixed-purple',['outer-mixed-r'],'fact','outer'),
];
applyDeterministic5RLayout(purpleBase);
const purpleBefore=getLastLayoutDiagnostics()!,purpleOld=positions(purpleBase);
const purpleExpanded:LayoutNode[]=[
  node('outer-cyan-only'),
  node('outer-blue-only',[],'fact','middle'),
  node('outer-purple-only',[],'fact','outer'),
  node('outer-mixed-blue',[],'fact','middle'),
  node('outer-mixed-r',['outer-mixed-blue'],'reasoning','middle'),
  node('outer-mixed-purple',['outer-mixed-r'],'fact','outer'),
  ...chain('outer-blue-growth',3,'middle'),
];
applyDeterministic5RLayout(purpleExpanded);
const purpleAfter=getLastLayoutDiagnostics()!;
assert.equal(purpleAfter.boundaries.cyanBlue,purpleBefore.boundaries.cyanBlue,'Blue/Purple expansion does not move the Cyan/Blue boundary');
assert.equal((purpleAfter.boundaries.bluePurple-purpleAfter.boundaries.cyanBlue)-(purpleBefore.boundaries.bluePurple-purpleBefore.boundaries.cyanBlue),LAYOUT_UNIT,'Blue thickness expands exactly one 5R step');
for(const id of ['outer-cyan-only','outer-blue-only'])assert(purpleExpanded.find(n=>n.id===id)!.pos!.equals(purpleOld.get(id)!),`${id} stays fixed because its component contains no Purple Knowledge`);
for(const id of ['outer-purple-only','outer-mixed-blue','outer-mixed-purple']){
  const current=purpleExpanded.find(n=>n.id===id)!;
  assert(Math.abs(current.pos!.length()-purpleOld.get(id)!.length()-LAYOUT_UNIT)<1e-7,`${id} moves outward exactly 5R with its Purple-containing component`);
  assertMappedAlongOldRay(purpleOld,purpleExpanded,purpleAfter,id);
  const component=componentOf(purpleAfter,id);
  assert.equal(purpleAfter.componentOptimizationPasses.get(component),0,'Purple boundary remap must not rerun chain optimization');
  assert.equal(purpleAfter.directionSwitchCounts.get(component),0,'Purple boundary remap must preserve the established chain direction');
}
const mixedPurpleComponent=componentOf(purpleAfter,'outer-mixed-blue');
assert.equal(purpleAfter.boundaryShiftByComponent.get(mixedPurpleComponent),LAYOUT_UNIT,'one Purple member makes the whole chain move outward 5R');
assert(purpleAfter.boundaryRemappedComponents.has(mixedPurpleComponent),'Blue member of a Purple-containing chain moves only because the whole chain moves');
assertGlobalSpacing(purpleExpanded,purpleAfter);

console.log('Atomic fixed-direction Cyan/Blue and Blue/Purple shell expansion remap checks passed.');
