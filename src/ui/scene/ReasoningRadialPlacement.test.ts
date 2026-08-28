import assert from 'node:assert/strict';
import { applyUniformLayerLayout } from './UniformLayerLayout';
import type { LayoutNode } from './Deterministic5RLayout';

const node=(id:string,premises:string[]=[],type='fact',layer:LayoutNode['declaredLayer']='inner'):LayoutNode=>({id,premises,type,declaredLayer:layer});

const nodes:LayoutNode[]=[
  node('reasoning-premise-a'),
  node('reasoning-premise-b'),
  node('reasoning-r',['reasoning-premise-a','reasoning-premise-b'],'reasoning'),
  node('reasoning-conclusion',['reasoning-r'],'theorem','middle'),
];

applyUniformLayerLayout(nodes);

const premiseA=nodes.find(n=>n.id==='reasoning-premise-a')!;
const premiseB=nodes.find(n=>n.id==='reasoning-premise-b')!;
const reasoning=nodes.find(n=>n.id==='reasoning-r')!;
const conclusion=nodes.find(n=>n.id==='reasoning-conclusion')!;
const premiseRadius=(premiseA.pos!.length()+premiseB.pos!.length())*0.5;
const conclusionRadius=conclusion.pos!.length();
const expectedReasoningRadius=(premiseRadius+conclusionRadius)*0.5;

assert(Math.abs(reasoning.pos!.length()-expectedReasoningRadius)<1e-7,'Reasoning radius must be exactly halfway between the premise and conclusion shell radii');
assert(reasoning.pos!.dot(conclusion.pos!)>0,'Reasoning must lie on the same radial ray as its conclusion, not the opposite ray');
assert(reasoning.pos!.clone().cross(conclusion.pos!).length()<1e-7,'Reasoning, conclusion and the ball centre must be collinear');
assert(Math.abs(reasoning.pos!.distanceTo(conclusion.pos!)-Math.abs(conclusionRadius-expectedReasoningRadius))<1e-7,'Reasoning→Conclusion must be a purely radial segment');
assert.equal(reasoning.address,undefined,'Reasoning remains non-authoritative and consumes no ISG cell');
assert(reasoning.homePos!.distanceTo(reasoning.pos!)<1e-12,'Reasoning home position must match its radial projection');

console.log('Reasoning midpoint-radius and conclusion-centre radial alignment checks passed.');
