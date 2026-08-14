import { clampGraphZoom, coreLabelsVisible, coreOrbitScreenPosition, coreSunContainsTriad, hasFiniteCoordinates, initialNodePosition, isCoreNodeId, layerForNode, nodeRadiusForType, ordinaryNodeCompensationScale, shouldRenderEdge } from './KnowledgeScene';
import { CORE_AMBIENT_LIGHT_INTENSITY, CORE_SUN_LIGHT_INTENSITY, CORE_SUN_RADIUS, DEFAULT_CAM_Z, LAYER_BANDS, MAX_GRAPH_ZOOM, MIN_GRAPH_ZOOM, SUN_ORBIT_RADIUS, SUN_RADIUS_MM, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function node(id:string,type:'axiom'|'fact'|'theorem'='fact',status:'pending'|'verified'='verified'){return{id,type,status}as const;}
for(const id of SUN_TRIAD_IDS){assert(isCoreNodeId(id),`${id} must be core`);assert(layerForNode(node(id,'axiom'))==='core',`${id} must stay in core layer`);assert(!shouldRenderEdge(id,'ordinary'),`core edge ${id}->ordinary must be suppressed`);assert(!shouldRenderEdge('ordinary',id),`core edge ordinary->${id} must be suppressed`);}
assert(shouldRenderEdge('a','b'),'ordinary dependency edges must remain visible');
assert(CORE_SUN_RADIUS>SUN_ORBIT_RADIUS+SUN_RADIUS_MM,'core sun must fully enclose triad orbit and core sphere radius');
assert(coreSunContainsTriad(),'core sun containment invariant failed');
for(const angle of [0,.7,2.4,5.9]){const points=SUN_TRIAD_IDS.map((_,i)=>coreOrbitScreenPosition(i,angle));const centroid=points.reduce((sum,p)=>sum.add(p),points[0].clone().set(0,0,0)).multiplyScalar(1/points.length);assert(centroid.length()<1e-10,'core triad projected centroid must remain at the exact visual center');for(const p of points){assert(Math.abs(p.z)<1e-12,'core triad orbit must remain camera-facing to prevent depth occlusion');assert(Math.abs(p.length()-SUN_ORBIT_RADIUS)<1e-10,'core triad must retain its orbital radius');}}
assert(CORE_SUN_LIGHT_INTENSITY>1,'core light must be strong enough to produce visible illumination');assert(CORE_AMBIENT_LIGHT_INTENSITY===0,'ambient light must stay disabled so solar illumination only weakens by distance and occlusion');
let sawMeaningfulZ=false;for(const sample of[node('inner-a','axiom'),node('inner-b','axiom'),node('middle-a'),node('middle-b','theorem'),node('outer-a','fact','pending'),node('outer-b','theorem','pending')]){const layer=layerForNode(sample),pos=initialNodePosition(sample),radius=pos.length();if(layer!=='core'){const band=LAYER_BANDS[layer];assert(radius>=band.rMin-1e-9&&radius<=band.rMax+1e-9,`${sample.id} outside ${layer} volume`);if(Math.abs(pos.z)>radius*.15)sawMeaningfulZ=true;assert(pos.distanceTo(initialNodePosition(sample))<1e-12,`${sample.id} layout must be deterministic`);}}
assert(sawMeaningfulZ,'layout regressed toward a flat XY disk');let positiveZ=0,negativeZ=0;for(let i=0;i<200;i++){const p=initialNodePosition(node(`volume-${i}`));if(p.z>0)positiveZ++;if(p.z<0)negativeZ++;}assert(positiveZ>60&&negativeZ>60,'3D distribution must occupy both hemispheres');
assert(clampGraphZoom(0)===MIN_GRAPH_ZOOM,'zoom must clamp at minimum');assert(clampGraphZoom(999)===MAX_GRAPH_ZOOM,'zoom must clamp at maximum');
assert(Math.abs(ordinaryNodeCompensationScale(4)-.25)<1e-12,'ordinary node geometry must inverse-scale so zoom changes spacing, not node radius');
assert(nodeRadiusForType('reasoning',9)===3,'reasoning process radius must be exactly one third of a conclusion radius');
assert(nodeRadiusForType('theorem',9)===9,'conclusion radius must keep the configured value');
assert(!coreLabelsVisible(9.99)&&coreLabelsVisible(10),'core labels must reveal only at 10x graph zoom');
assert(DEFAULT_CAM_Z===640,'camera baseline changed unexpectedly; graph zoom must not require camera movement');
assert(hasFiniteCoordinates({x:0,y:-1,z:2}),'finite scene coordinates must be accepted');
assert(!hasFiniteCoordinates({x:Number.NaN,y:0,z:0}),'NaN edge/node coordinates must be rejected before geometry creation');
assert(!hasFiniteCoordinates({x:0,y:Number.POSITIVE_INFINITY,z:0}),'infinite edge/node coordinates must be rejected before geometry creation');
console.log('Knowledge scene regression tests passed');
