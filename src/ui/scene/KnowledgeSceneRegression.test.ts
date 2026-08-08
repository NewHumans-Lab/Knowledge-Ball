import { clampGraphZoom, coreLabelsVisible, initialNodePosition, isCoreNodeId, layerForNode, ordinaryNodeCompensationScale, shouldRenderEdge } from './KnowledgeScene';
import { DEFAULT_CAM_Z, LAYER_BANDS, MAX_GRAPH_ZOOM, MIN_GRAPH_ZOOM, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
function node(id:string,type:'axiom'|'fact'|'theorem'='fact',status:'pending'|'verified'='verified'){return{id,type,status}as const;}
for(const id of SUN_TRIAD_IDS){assert(isCoreNodeId(id),`${id} must be core`);assert(layerForNode(node(id,'axiom'))==='core',`${id} must stay in core layer`);assert(!shouldRenderEdge(id,'ordinary'),`core edge ${id}->ordinary must be suppressed`);assert(!shouldRenderEdge('ordinary',id),`core edge ordinary->${id} must be suppressed`);}
assert(shouldRenderEdge('a','b'),'ordinary dependency edges must remain visible');
let sawMeaningfulZ=false;for(const sample of[node('inner-a','axiom'),node('inner-b','axiom'),node('middle-a'),node('middle-b','theorem'),node('outer-a','fact','pending'),node('outer-b','theorem','pending')]){const layer=layerForNode(sample),pos=initialNodePosition(sample),radius=pos.length();if(layer!=='core'){const band=LAYER_BANDS[layer];assert(radius>=band.rMin-1e-9&&radius<=band.rMax+1e-9,`${sample.id} outside ${layer} volume`);if(Math.abs(pos.z)>radius*.15)sawMeaningfulZ=true;assert(pos.distanceTo(initialNodePosition(sample))<1e-12,`${sample.id} layout must be deterministic`);}}
assert(sawMeaningfulZ,'layout regressed toward a flat XY disk');let positiveZ=0,negativeZ=0;for(let i=0;i<200;i++){const p=initialNodePosition(node(`volume-${i}`));if(p.z>0)positiveZ++;if(p.z<0)negativeZ++;}assert(positiveZ>60&&negativeZ>60,'3D distribution must occupy both hemispheres');
assert(clampGraphZoom(0)===MIN_GRAPH_ZOOM,'zoom must clamp at minimum');assert(clampGraphZoom(999)===MAX_GRAPH_ZOOM,'zoom must clamp at maximum');
assert(Math.abs(ordinaryNodeCompensationScale(4)-.25)<1e-12,'ordinary node geometry must inverse-scale so zoom changes spacing, not node radius');
assert(!coreLabelsVisible(9.99)&&coreLabelsVisible(10),'core labels must reveal only at 10x graph zoom');
assert(DEFAULT_CAM_Z===640,'camera baseline changed unexpectedly; graph zoom must not require camera movement');
console.log('Knowledge scene regression tests passed');
