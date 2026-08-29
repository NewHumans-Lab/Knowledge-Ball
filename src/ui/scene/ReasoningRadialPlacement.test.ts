import assert from 'node:assert/strict';
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
const rotatedConclusion=conclusion.pos!.clone().applyAxisAngle({x:0,y:1,z:0} as never,0.13);
conclusion.pos!.copy(rotatedConclusion);
applyReasoningRadialPlacement(nodes);
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Reasoning must follow its served conclusion after that ordinary ball moves');

console.log('Reasoning single-conclusion semantic ownership and radial-follow checks passed.');
