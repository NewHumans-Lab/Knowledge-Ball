import { readFileSync } from 'node:fs';
import { clampGraphZoom, colorForNode, coreLabelsVisible, coreOrbitScreenPosition, coreSunContainsTriad, hasFiniteCoordinates, initialNodePosition, isCoreNodeId, layerForNode, nodeRadiusForType, ordinaryNodeCompensationScale, pendingPulseAtCycleMs, pendingPulsePhaseMs, shouldRenderEdge } from './KnowledgeScene';
import { CORE_AMBIENT_LIGHT_INTENSITY, CORE_SUN_LIGHT_INTENSITY, CORE_SUN_RADIUS, DEFAULT_CAM_Z, KNOWLEDGE_SCENE_THEME, LAYER_BANDS, MAX_GRAPH_ZOOM, MIN_GRAPH_ZOOM, NODE_LAYER_COLOR, NODE_SPECIAL_COLOR, PENDING_PULSE_FADE_MS, PENDING_PULSE_LOW_MS, PENDING_PULSE_MIN_OPACITY, PENDING_PULSE_MIN_SCALE, PENDING_PULSE_PERIOD_MS, PENDING_PULSE_RISE_MS, PENDING_PULSE_VISIBLE_MS, SUN_ORBIT_RADIUS, SUN_RADIUS_MM, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
type TestType='axiom'|'definition'|'fact'|'theorem'|'hypothesis'|'prediction'|'opinion'|'value'|'reasoning'|'logic-symbol';
type TestStatus='pending'|'verified'|'suspended'|'disputed'|'falsified';
function node(id:string,type:TestType='fact',status:TestStatus='verified'){return{id,type,status}as const;}
function rgb(hex:number){return{r:(hex>>16)&255,g:(hex>>8)&255,b:hex&255};}
for(const id of SUN_TRIAD_IDS){assert(isCoreNodeId(id),`${id} must be core`);assert(layerForNode(node(id,'axiom'))==='core',`${id} must stay in core layer`);assert(!shouldRenderEdge(id,'ordinary'),`core edge ${id}->ordinary must be suppressed`);assert(!shouldRenderEdge('ordinary',id),`core edge ordinary->${id} must be suppressed`);}
assert(shouldRenderEdge('a','b'),'ordinary dependency edges must remain visible');
assert(CORE_SUN_RADIUS>SUN_ORBIT_RADIUS+SUN_RADIUS_MM,'core sun must fully enclose triad orbit and core sphere radius');
assert(coreSunContainsTriad(),'core sun containment invariant failed');
for(const angle of [0,.7,2.4,5.9]){const points=SUN_TRIAD_IDS.map((_,i)=>coreOrbitScreenPosition(i,angle));const centroid=points.reduce((sum,p)=>sum.add(p),points[0].clone().set(0,0,0)).multiplyScalar(1/points.length);assert(centroid.length()<1e-10,'core triad projected centroid must remain at the exact visual center');for(const p of points){assert(Math.abs(p.z)<1e-12,'core triad orbit must remain camera-facing to prevent depth occlusion');assert(Math.abs(p.length()-SUN_ORBIT_RADIUS)<1e-10,'core triad must retain its orbital radius');}}
assert(CORE_SUN_LIGHT_INTENSITY>1,'core light must be strong enough to produce visible illumination');assert(CORE_AMBIENT_LIGHT_INTENSITY===0,'ambient light must stay disabled so solar illumination only weakens by distance and occlusion');

// Three-layer semantic projection must match the product vocabulary, not an old type-color shortcut.
assert(layerForNode(node('definition','definition','verified'))==='inner','definitions must live in the descriptive inner layer');
assert(layerForNode(node('fact','fact','verified'))==='inner','verified descriptive facts must live in the inner layer');
assert(layerForNode(node('axiom','axiom','verified'))==='middle','axioms must live in the deterministic middle layer');
assert(layerForNode(node('theorem','theorem','verified'))==='middle','theorems must live in the deterministic middle layer');
for(const type of ['hypothesis','prediction','opinion','value'] as const)assert(layerForNode(node(`outer-${type}`,type,'verified'))==='outer',`${type} must remain in the uncertain outer layer even when accepted`);
assert(layerForNode(node('pending-definition','definition','pending'))==='outer','pending state must temporarily project knowledge to the outer layer');
assert(layerForNode(node('disputed-theorem','theorem','disputed'))==='outer','disputed state must project knowledge to the outer layer');

// Canonical node-color semantics: falsified overrides everything; reasoning/logic structural nodes stay white;
// all other nodes use the color of the layer derived from their real type/status fields.
assert(colorForNode(node('inner-definition','definition','verified'))===NODE_LAYER_COLOR.inner,'verified descriptive inner knowledge must use the inner ice-blue color');
assert(colorForNode(node('middle-theorem','theorem','verified'))===NODE_LAYER_COLOR.middle,'verified deterministic middle knowledge must use the middle true-blue color');
assert(colorForNode(node('outer-hypothesis','hypothesis','verified'))===NODE_LAYER_COLOR.outer,'uncertain knowledge types must use the outer violet color');
assert(colorForNode(node('outer-pending-definition','definition','pending'))===NODE_LAYER_COLOR.outer,'pending knowledge must use the outer violet color regardless of its eventual inner type');
assert(colorForNode(node('outer-disputed-theorem','theorem','disputed'))===NODE_LAYER_COLOR.outer,'disputed knowledge must use the outer violet color');
assert(colorForNode(node('reasoning-verified','reasoning','verified'))===NODE_SPECIAL_COLOR.structural,'reasoning nodes must be white');
assert(colorForNode(node('reasoning-pending','reasoning','pending'))===NODE_SPECIAL_COLOR.structural,'pending reasoning remains white while pending is conveyed by whole-node blinking');
assert(colorForNode(node('logic-node','logic-symbol','verified'))===NODE_SPECIAL_COLOR.structural,'logic/relation structural nodes must be white');
assert(colorForNode(node('falsified-reasoning','reasoning','falsified'))===NODE_SPECIAL_COLOR.falsified,'certainly false knowledge must be red even when the node would otherwise be structural white');
const middleRgb=rgb(KNOWLEDGE_SCENE_THEME.node.middle),innerRgb=rgb(KNOWLEDGE_SCENE_THEME.node.inner);
assert(middleRgb.b-middleRgb.g>=60&&middleRgb.b>middleRgb.r,'middle-layer color must read as visibly blue rather than cyan/green');
assert(innerRgb.b>=innerRgb.g&&innerRgb.g>innerRgb.r,'inner-layer color may be icy cyan but must not be green-dominant');
assert(KNOWLEDGE_SCENE_THEME.mastery.tint===0xFFFFFF,'mastery glow tint must stay neutral white so it cannot recolor semantic node hues');
assert(KNOWLEDGE_SCENE_THEME.edge.normalOpacity<=.16,'ordinary relation lines must stay visually quiet');
assert(KNOWLEDGE_SCENE_THEME.edge.activeOpacity>=.4,'selected relation paths must remain visibly distinguishable');
assert(KNOWLEDGE_SCENE_THEME.sun.core===0xFFFFFF,'sun core must remain white');
assert(Number(KNOWLEDGE_SCENE_THEME.sun.corona)!==Number(KNOWLEDGE_SCENE_THEME.sun.halo),'sun corona and outer halo must remain distinct color layers');

let sawMeaningfulZ=false;for(const sample of[node('inner-a','definition'),node('inner-b','fact'),node('middle-a','axiom'),node('middle-b','theorem'),node('outer-a','hypothesis'),node('outer-b','theorem','pending')]){const layer=layerForNode(sample),pos=initialNodePosition(sample),radius=pos.length();if(layer!=='core'){const band=LAYER_BANDS[layer];assert(radius>=band.rMin-1e-9&&radius<=band.rMax+1e-9,`${sample.id} outside ${layer} volume`);if(Math.abs(pos.z)>radius*.15)sawMeaningfulZ=true;assert(pos.distanceTo(initialNodePosition(sample))<1e-12,`${sample.id} layout must be deterministic`);}}
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

assert(PENDING_PULSE_VISIBLE_MS+PENDING_PULSE_FADE_MS+PENDING_PULSE_LOW_MS+PENDING_PULSE_RISE_MS===PENDING_PULSE_PERIOD_MS,'pending pulse stages must fill exactly one period');
const visiblePulse=pendingPulseAtCycleMs(0);assert(visiblePulse.opacityFactor===1&&visiblePulse.scale===1,'pending node must spend its visible stage at full opacity and scale');
const fadeMid=pendingPulseAtCycleMs(PENDING_PULSE_VISIBLE_MS+PENDING_PULSE_FADE_MS/2);assert(fadeMid.opacityFactor<1&&fadeMid.opacityFactor>PENDING_PULSE_MIN_OPACITY,'pending node must fade smoothly between full and low opacity');assert(fadeMid.scale<1&&fadeMid.scale>PENDING_PULSE_MIN_SCALE,'pending node must shrink smoothly during fade');
const lowPulse=pendingPulseAtCycleMs(PENDING_PULSE_VISIBLE_MS+PENDING_PULSE_FADE_MS+PENDING_PULSE_LOW_MS/2);assert(Math.abs(lowPulse.opacityFactor-PENDING_PULSE_MIN_OPACITY)<1e-12,'pending node low stage must use configured minimum opacity');assert(Math.abs(lowPulse.scale-PENDING_PULSE_MIN_SCALE)<1e-12,'pending node low stage must use configured minimum scale');
const recoveredPulse=pendingPulseAtCycleMs(PENDING_PULSE_PERIOD_MS);assert(recoveredPulse.opacityFactor===1&&recoveredPulse.scale===1,'pending pulse must recover exactly at the next period');
const phaseA=pendingPulsePhaseMs('pending-a');assert(phaseA===pendingPulsePhaseMs('pending-a'),'pending phase must be deterministic for a node id');const phases=new Set(['pending-a','pending-b','pending-c','pending-d'].map(pendingPulsePhaseMs));assert(phases.size>1,'pending nodes must not all share the same phase');

const sceneSource=readFileSync('src/ui/scene/KnowledgeScene.ts','utf8');
const tapStart=sceneSource.indexOf('const up=');
const tapEnd=sceneSource.indexOf('const wheel=');
const overlayStart=sceneSource.indexOf('setOverlayVisible:');
const overlayEnd=sceneSource.indexOf(',resize,setLabelBrightness');
assert(tapStart>=0&&tapEnd>tapStart,'node tap implementation must remain discoverable');
assert(overlayStart>=0&&overlayEnd>overlayStart,'overlay lifecycle implementation must remain discoverable');
const tapSource=sceneSource.slice(tapStart,tapEnd);
const overlaySource=sceneSource.slice(overlayStart,overlayEnd);
assert(tapSource.includes('callbacks.onNodeTap(nodeId)'),'node tap must emit exactly through the node-tap callback');
assert(!tapSource.includes('queueMicrotask'),'node tap must not defer panel dispatch into the microtask queue');
assert(!tapSource.includes('forceContextLoss'),'node tap must never force WebGL context loss');
assert(!tapSource.includes('forceContextRestore'),'node tap must never force context restore');
assert(!tapSource.includes('domElement.remove'),'node tap must keep the renderer canvas attached');
assert(!overlaySource.includes('forceContextLoss'),'overlay open must not destroy the WebGL context');
assert(!overlaySource.includes('forceContextRestore'),'overlay close must not force context restoration');
assert(!overlaySource.includes('domElement.remove'),'overlay lifecycle must keep the renderer canvas attached');
assert(!overlaySource.includes('pointerEvents'),'overlay lifecycle must not retarget the active pointer by mutating canvas hit testing');
assert(sceneSource.includes('const pauseFrameLoop='),'scene must pause work without destroying GPU state');
assert(sceneSource.includes('const resumeFrameLoop='),'scene must resume work without recreating GPU state');
assert(sceneSource.includes("const down=(e:PointerEvent)=>{if(overlayVisible)return;"),'pointerdown must be gated by scene overlay state');
assert(sceneSource.includes("const move=(e:PointerEvent)=>{if(overlayVisible)return;"),'pointermove must be gated by scene overlay state');
assert(sceneSource.includes("const up=(e:PointerEvent)=>{if(overlayVisible)return;"),'pointerup/pointercancel must be gated by scene overlay state');
assert(sceneSource.includes("const wheel=(e:WheelEvent)=>{if(overlayVisible)return;"),'wheel input must be gated by scene overlay state');
const pulseStart=sceneSource.indexOf('const applyPendingPulse=');
const pulseEnd=sceneSource.indexOf('const physics=');
assert(pulseStart>=0&&pulseEnd>pulseStart,'pending pulse implementation must remain discoverable');
const pulseSource=sceneSource.slice(pulseStart,pulseEnd);
assert(!pulseSource.includes('setInterval'),'pending pulse must never create per-node intervals');
assert(!pulseSource.includes('setTimeout'),'pending pulse must never create per-node timers');
assert(pulseSource.includes('r.group.scale.setScalar(pulse.scale)'),'pending state must pulse the whole node group, not the mastery glow alone');
assert(pulseSource.includes('r.baseShellOpacity*pulse.opacityFactor'),'pending pulse must fade the node shell');
assert(pulseSource.includes('r.basePointOpacity*pulse.opacityFactor'),'pending pulse must fade the semantic color point');
assert(pulseSource.includes('r.baseDotOpacity*pulse.opacityFactor'),'pending pulse must fade the mastery dot proportionally without changing mastery semantics');
assert(sceneSource.includes("pending=!core&&n.status==='pending'"),'only non-core pending nodes may receive the pending pulse');
assert(sceneSource.includes('r.shell.visible=!largeMobileGraph||core||pending||selectedId===n.id'),'pending shells must remain renderable in large mobile graphs');
assert(sceneSource.includes('r.point.visible=!core'),'large-mobile optimization must retain the lightweight semantic color point even when heavy shells are hidden');
assert(sceneSource.includes('r.point.scale.setScalar'),'semantic node color must have its own lightweight visual carrier independent of mastery glow');
assert(sceneSource.includes('pendingNodeIds.size>0'),'large mobile graphs must keep lightweight rendering alive while pending nodes animate');
assert(sceneSource.includes('const colorFor=(n:KnowledgeSceneNode)=>colorForNode(n);'),'scene rendering must use the canonical status/layer-aware color mapping');
assert(sceneSource.includes('wireframe:false'),'ordinary nodes must render as solid scientific points rather than the old dotted wireframe shells');
assert(sceneSource.includes('KNOWLEDGE_SCENE_THEME.mastery.tint'),'mastery glow must use the centralized neutral tint');
for(const legacy of ['0x62AAA9','0xf0c66e','rgba(134,241,232','rgba(78,200,205'])assert(!sceneSource.includes(legacy),`legacy scene color ${legacy} must not leak back into Three.js rendering`);
console.log('Knowledge scene regression tests passed');
