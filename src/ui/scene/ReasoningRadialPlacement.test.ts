import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindReasoningConclusions, reasoningConclusionBindingFor } from '../../domain/ReasoningConclusion';
import { LAYOUT_UNIT, type LayoutNode } from './Deterministic5RLayout';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import { applyReasoningRadialPlacement } from './ReasoningRadialPlacement';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});
const near=(left:THREE.Vector3,right:THREE.Vector3,tolerance=1e-7)=>left.distanceTo(right)<tolerance;

const nodes:LayoutNode[]=[
  node('reasoning-premise-a'),
  node('reasoning-premise-b'),
  node('reasoning-r',['reasoning-premise-a','reasoning-premise-b'],'reasoning'),
  node('reasoning-conclusion',['reasoning-r'],'theorem','middle'),
  node('unrelated-ordinary',[],'theorem','middle'),
];

applyUniformLayerLayout(nodes);

const premiseA=nodes.find(n=>n.id==='reasoning-premise-a')!;
const premiseB=nodes.find(n=>n.id==='reasoning-premise-b')!;
const reasoning=nodes.find(n=>n.id==='reasoning-r')!;
const conclusion=nodes.find(n=>n.id==='reasoning-conclusion')!;
const premiseRadius=(premiseA.pos!.length()+premiseB.pos!.length())*0.5;
const conclusionRadius=conclusion.pos!.length();
const expectedReasoningRadius=(premiseRadius+conclusionRadius)*0.5;

assert.equal(reasoningConclusionBindingFor(reasoning)?.conclusionId,'reasoning-conclusion','Reasoning must have one semantic ordinary-ball conclusion owner before geometry');
assert(Math.abs(reasoning.pos!.length()-expectedReasoningRadius)<1e-7,'A single legacy/winning Reasoning must still own the original radial P0 midpoint');
assert(reasoning.pos!.dot(conclusion.pos!)>0,'Single winning Reasoning must lie on the same radial ray as its served conclusion');
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Single winning Reasoning P0, served conclusion and the ball centre must be collinear');
assert(Math.abs(reasoning.pos!.distanceTo(conclusion.pos!)-Math.abs(conclusionRadius-expectedReasoningRadius))<1e-7,'Single winning Reasoning→served conclusion must remain a purely radial segment');
assert.equal(reasoning.address,undefined,'Reasoning remains non-authoritative and consumes no ISG cell');
assert(reasoning.homePos!.distanceTo(reasoning.pos!)<1e-12,'Reasoning home position must match its conclusion-owned projection');

// P0 is semantic/runtime geometry, not a one-time XYZ copy. Moving the concrete
// conclusion recomputes the winning Reasoning anchor from the new ordinary geometry.
conclusion.pos!.applyAxisAngle(new THREE.Vector3(0,1,0),0.13);
applyReasoningRadialPlacement(nodes);
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Single winning Reasoning must follow its served conclusion after that ordinary ball moves');

// Invalid/unbound Reasoning may never retain a stale position from an older
// render generation and become a free-floating visual ball.
const orphan=node('orphan-reasoning',['reasoning-premise-a'],'reasoning');
orphan.pos=new THREE.Vector3(10,20,30);orphan.homePos=orphan.pos.clone();orphan.vel=new THREE.Vector3(1,1,1);
applyReasoningRadialPlacement([...nodes,orphan]);
assert.equal(orphan.pos,undefined,'unbound Reasoning must have no renderable position');
assert.equal(orphan.homePos,undefined,'unbound Reasoning must have no stale home position');
assert.equal(orphan.address,undefined,'unbound Reasoning never receives spatial authority');
assert(orphan.vel!.lengthSq()===0,'unbound Reasoning velocity must be neutralized');

const lineage=(
  topicId:string,
  proposal:'new'|'optimization'|'opposition',
  role:'current'|'history'|'opposition'|'candidate-history'|'candidate-opposition',
  rank:number,
  reasoningSide?:'normal'|'opposition',
  reasoningSideRank?:number,
  reasoningDominant?:boolean,
  targetId?:string,
)=>({topicId,proposal,role,rank,reasoningSide,reasoningSideRank,reasoningDominant,targetId});

// Dual-camp family: winner owns P0, losing head is exactly 5R away, winner
// history extends through the opposite side, losing history continues outward,
// and a pending candidate sits 5R from its target on the perpendicular tangent.
const dualPremise=node('dual-premise');
dualPremise.pos=new THREE.Vector3(60,0,80); // radius 100; gives a deterministic +X tangent around a +Z conclusion.
dualPremise.homePos=dualPremise.pos.clone();
const dualWhite=node('dual-white',['dual-premise'],'reasoning');
dualWhite.lineage=lineage('dual-topic','new','current',0,'normal',0,true);
const dualRed=node('dual-red',['dual-premise'],'reasoning');
dualRed.lineage=lineage('dual-topic','opposition','current',0,'opposition',0,false,'dual-white');
const dualWhiteHistory=node('dual-white-h1',['dual-premise'],'reasoning');
dualWhiteHistory.lineage=lineage('dual-topic','optimization','history',1,'normal',1,false,'dual-white');
const dualRedHistory=node('dual-red-h1',['dual-premise'],'reasoning');
dualRedHistory.lineage=lineage('dual-topic','optimization','opposition',1,'opposition',1,false,'dual-red');
const dualPending=node('dual-pending',['dual-premise'],'reasoning');
dualPending.lineage=lineage('dual-topic','optimization','candidate-history',0,'normal',0,false,'dual-white');
const dualStray=node('dual-stray',['dual-premise'],'reasoning');
dualStray.lineage=lineage('dual-topic','optimization','current',0,undefined,undefined,false,'dual-white');
dualStray.pos=new THREE.Vector3(9,9,9);
dualStray.homePos=dualStray.pos.clone();
const dualConclusion=node('dual-conclusion',['dual-white'],'theorem','middle');
dualConclusion.pos=new THREE.Vector3(0,0,200);
dualConclusion.homePos=dualConclusion.pos.clone();
const dualNodes=[dualPremise,dualWhite,dualRed,dualWhiteHistory,dualRedHistory,dualPending,dualStray,dualConclusion];
bindReasoningConclusions(dualNodes);
assert.equal(reasoningConclusionBindingFor(dualStray)?.conclusionId,'dual-conclusion','malformed stray can still inherit a concrete conclusion binding before topology validation');
applyReasoningRadialPlacement(dualNodes);

const expectedDualP0=new THREE.Vector3(0,0,150);
assert(near(dualWhite.pos!,expectedDualP0),'dominant white head must own the original P0');
assert(Math.abs(dualWhite.pos!.distanceTo(dualRed.pos!)-LAYOUT_UNIT)<1e-7,'losing red head must be exactly 5R from winning P0');
assert(Math.abs(dualWhite.pos!.distanceTo(dualWhiteHistory.pos!)-LAYOUT_UNIT)<1e-7,'winning-side nearest history must be exactly one 5R step behind P0');
assert(Math.abs(dualRed.pos!.distanceTo(dualRedHistory.pos!)-LAYOUT_UNIT)<1e-7,'losing-side nearest history must continue exactly one 5R step beyond its head');
assert(Math.abs(dualWhite.pos!.distanceTo(dualPending.pos!)-LAYOUT_UNIT)<1e-7,'pending Reasoning must be exactly 5R from the head it targets');
assert.equal(dualStray.pos,undefined,'a conclusion-bound Reasoning with zero canonical relation edges must not receive standalone geometry');
assert.equal(dualStray.homePos,undefined,'zero-edge Reasoning must not retain stale home geometry');

const positionedDualReasoning=[dualWhite,dualRed,dualWhiteHistory,dualRedHistory,dualPending];
for(let i=0;i<positionedDualReasoning.length;i+=1){
  for(let j=i+1;j<positionedDualReasoning.length;j+=1){
    const distance=positionedDualReasoning[i].pos!.distanceTo(positionedDualReasoning[j].pos!);
    assert(distance+1e-7>=LAYOUT_UNIT,`Reasoning pair ${positionedDualReasoning[i].id}/${positionedDualReasoning[j].id} must never overlap below 5R`);
  }
}

// Dominance changes P0 ownership instead of color or semantic family identity.
dualWhite.lineage={...dualWhite.lineage!,reasoningDominant:false};
dualRed.lineage={...dualRed.lineage!,reasoningDominant:true};
applyReasoningRadialPlacement(dualNodes);
assert(near(dualRed.pos!,expectedDualP0),'when red wins, the red head must move onto P0');
assert(Math.abs(dualRed.pos!.distanceTo(dualWhite.pos!)-LAYOUT_UNIT)<1e-7,'when red wins, the losing white head must remain exactly 5R from P0');
assert(Math.abs(dualRed.pos!.distanceTo(dualRedHistory.pos!)-LAYOUT_UNIT)<1e-7,'red history must become the winning-side 5R history chain when red dominates');
assert(Math.abs(dualWhite.pos!.distanceTo(dualWhiteHistory.pos!)-LAYOUT_UNIT)<1e-7,'white history must continue beyond the losing white head when red dominates');
assert.equal(dualStray.pos,undefined,'zero-edge stray must remain absent after dominance changes');

// Unrelated Reasoning families can have colliding raw radial P0 candidates. The
// Reasoning-only collision pass must move the later family, never Knowledge, and
// keep every cross-family pair >=5R.
const collisionPremise=node('zz-premise');
collisionPremise.pos=new THREE.Vector3(60,0,80);
collisionPremise.homePos=collisionPremise.pos.clone();
const collisionReasoning=node('zz-reasoning',['zz-premise'],'reasoning');
collisionReasoning.lineage=lineage('zz-topic','new','current',0);
const collisionConclusion=node('zz-conclusion',['zz-reasoning'],'theorem','middle');
collisionConclusion.pos=new THREE.Vector3(0,0,200);
collisionConclusion.homePos=collisionConclusion.pos.clone();
const combined=[...dualNodes,collisionPremise,collisionReasoning,collisionConclusion];
bindReasoningConclusions(combined);
const ordinarySnapshots=new Map(
  combined.filter(item=>item.type!=='reasoning'&&item.pos).map(item=>[item.id,item.pos!.clone()] as const),
);
applyReasoningRadialPlacement(combined);

for(const [id,before] of ordinarySnapshots){
  const ordinary=combined.find(item=>item.id===id)!;
  assert(ordinary.pos!.distanceTo(before)<1e-12,`Reasoning collision resolution must never move ordinary Knowledge: ${id}`);
}
const allPositionedReasoning=combined.filter(item=>item.type==='reasoning'&&item.pos);
for(let i=0;i<allPositionedReasoning.length;i+=1){
  for(let j=i+1;j<allPositionedReasoning.length;j+=1){
    const distance=allPositionedReasoning[i].pos!.distanceTo(allPositionedReasoning[j].pos!);
    assert(distance+1e-7>=LAYOUT_UNIT,`all unrelated/non-adjacent Reasoning must remain >=5R: ${allPositionedReasoning[i].id}/${allPositionedReasoning[j].id}`);
  }
}
assert(!near(collisionReasoning.pos!,expectedDualP0),'a later unrelated Reasoning family with a colliding raw P0 must move to the nearest legal Reasoning-only anchor');
assert.equal(collisionReasoning.address,undefined,'collision resolution must not turn Reasoning into an authoritative ISG occupant');

console.log('Reasoning winner-P0, 5R lineage separation, zero-edge isolation, pending placement and cross-family spacing checks passed.');