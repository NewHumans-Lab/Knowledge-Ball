import assert from 'node:assert/strict';
import * as THREE from 'three';
import { reasoningConclusionBindingFor } from '../../domain/ReasoningConclusion';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import { applyReasoningRadialPlacement } from './ReasoningRadialPlacement';
import type { LayoutNode } from './Deterministic5RLayout';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});

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
assert(Math.abs(reasoning.pos!.length()-expectedReasoningRadius)<1e-7,'Reasoning radius must remain halfway between its premises and its one served conclusion');
assert(reasoning.pos!.dot(conclusion.pos!)>0,'Reasoning must lie on the same radial ray as its served conclusion, not the opposite ray');
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Reasoning, served conclusion and the ball centre must be collinear');
assert(Math.abs(reasoning.pos!.distanceTo(conclusion.pos!)-Math.abs(conclusionRadius-expectedReasoningRadius))<1e-7,'Reasoning→served conclusion must be a purely radial segment');
assert.equal(reasoning.address,undefined,'Reasoning remains non-authoritative and consumes no ISG cell');
assert(reasoning.homePos!.distanceTo(reasoning.pos!)<1e-12,'Reasoning home position must match its conclusion-owned radial projection');

// The binding is semantic, not a one-time XYZ copy. If the served conclusion
// moves after ordinary local reflow, Reasoning must recompute on that ball's ray.
conclusion.pos!.applyAxisAngle(new THREE.Vector3(0,1,0),0.13);
applyReasoningRadialPlacement(nodes);
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Reasoning must follow its served conclusion after that ordinary ball moves');

// Invalid/unbound Reasoning may never retain a stale position from an older
// render generation and become a free-floating visual ball.
const orphan=node('orphan-reasoning',['reasoning-premise-a'],'reasoning');
orphan.pos=new THREE.Vector3(10,20,30);orphan.homePos=orphan.pos.clone();orphan.vel=new THREE.Vector3(1,1,1);
applyReasoningRadialPlacement([...nodes,orphan]);
assert.equal(orphan.pos,undefined,'unbound Reasoning must have no renderable position');
assert.equal(orphan.homePos,undefined,'unbound Reasoning must have no stale home position');
assert.equal(orphan.address,undefined,'unbound Reasoning never receives spatial authority');
assert(orphan.vel!.lengthSq()===0,'unbound Reasoning velocity must be neutralized');

console.log('Reasoning single-conclusion semantic ownership and radial-follow checks passed.');
