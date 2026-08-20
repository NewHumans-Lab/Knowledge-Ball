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
assert(CORE_SUN_LIGHT_INTENSITY>1,'core light must remain available for the sun visual system');
assert(CORE_AMBIENT_LIGHT_INTENSITY===0,'ambient light stays disabled; ordinary semantic shells use a neutral unlit matcap instead');

assert(layerForNode(node('definition','definition','verified'))==='inner','definitions must live in the descriptive inner layer');
assert(layerForNode(node('fact','fact','verified'))==='inner','verified descriptive facts must live in the inner layer');
assert(layerForNode(node('axiom','axiom','verified'))==='middle','axioms must live in the deterministic middle layer');
assert(layerForNode(node('theorem','theorem','verified'))==='middle','theorems must live in the deterministic middle layer');
for(const type of ['hypothesis','prediction','opinion','value'] as const)assert(layerForNode(node(`outer-${type}`,type,'verified'))==='outer',`${type} must remain in the uncertain outer layer even when accepted`);
assert(layerForNode(node('pending-definition','definition','pending'))==='outer','pending state must temporarily project knowledge to the outer layer');
assert(layerForNode(node('disputed-theorem','theorem','disputed'))==='outer','disputed state must project knowledge to the outer layer');

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
assert(KNOWLEDGE_SCENE_THEME.node.shellOpacity===1,'ordinary semantic shell must fully occlude the page backdrop');
assert(KNOWLEDGE_SCENE_THEME.node.pointOpacity<=.6,'semantic aura must remain secondary to the opaque node body');
assert(KNOWLEDGE_SCENE_THEME.node.sphereWidthSegments>=24&&KNOWLEDGE_SCENE_THEME.node.sphereHeightSegments>=16,'ordinary spheres need enough shared geometry segments to avoid visible polygonal silhouettes');
assert(KNOWLEDGE_SCENE_THEME.node.matcapLight===255,'matcap highlight must be able to reach the canonical semantic color');
const matcapSourceSpan=(KNOWLEDGE_SCENE_THEME.node.matcapLight-KNOWLEDGE_SCENE_THEME.node.matcapDark)/KNOWLEDGE_SCENE_THEME.node.matcapLight;
assert(matcapSourceSpan>=.50&&matcapSourceSpan<=.56,'matcap source luminance span must stay calibrated for the requested 15-20% rendered regional sphere contrast');
const matcapMidPosition=(KNOWLEDGE_SCENE_THEME.node.matcapLight-KNOWLEDGE_SCENE_THEME.node.matcapMid)/(KNOWLEDGE_SCENE_THEME.node.matcapLight-KNOWLEDGE_SCENE_THEME.node.matcapDark);
assert(matcapMidPosition>=.65&&matcapMidPosition<=.75,'matcap midtone must remain inside the calibrated sphere-depth ramp instead of collapsing toward either endpoint');
assert(KNOWLEDGE_SCENE_THEME.node.matcapDark<KNOWLEDGE_SCENE_THEME.node.matcapMid&&KNOWLEDGE_SCENE_THEME.node.matcapMid<KNOWLEDGE_SCENE_THEME.node.matcapLight,'matcap must encode a real but bounded light-to-dark gradient');
assert(KNOWLEDGE_SCENE_THEME.renderer.antialias,'WebGL antialiasing must stay enabled for small node silhouettes');
assert(KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio>=1&&KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio<=1.5,'mobile pixel ratio must improve edge sampling without returning to an expensive full device DPR');
assert(KNOWLEDGE_SCENE_THEME.mastery.tint===0xFFFFFF,'mastery glow tint must stay neutral white so it cannot recolor semantic node hues');
assert(KNOWLEDGE_SCENE_THEME.edge.normal===0xB9D8F5,'ordinary relation lines must use the approved light blue');
assert(KNOWLEDGE_SCENE_THEME.edge.active===0xD9ECFF,'relations incident to the clicked node must use the approved highlight color');
assert(KNOWLEDGE_SCENE_THEME.edge.logic===KNOWLEDGE_SCENE_THEME.edge.normal,'logic relations must share the ordinary line color');
assert(KNOWLEDGE_SCENE_THEME.edge.twin===KNOWLEDGE_SCENE_THEME.edge.normal,'bidirectional/twin relations must share the ordinary line color when not selected');
assert(KNOWLEDGE_SCENE_THEME.edge.normalOpacity<=.16,'ordinary relation lines must stay visually quiet');
assert(KNOWLEDGE_SCENE_THEME.edge.activeOpacity>=.4,'selected relation paths must remain visibly distinguishable');
assert(KNOWLEDGE_SCENE_THEME.sun.core===0xFFFFFF,'sun core must remain white');
assert(Number(KNOWLEDGE_SCENE_THEME.sun.corona)!==Number(KNOWLEDGE_SCENE_THEME.sun.halo),'sun corona and outer halo must remain distinct color layers');
assert(KNOWLEDGE_SCENE_THEME.sun.coronaScale<=4&&KNOWLEDGE_SCENE_THEME.sun.haloScale<=6,'sun glow must not wash most of a phone viewport in cyan/violet haze');

let sawMeaningfulZ=false;
for(const sample of[node('inner-a','definition'),node('inner-b','fact'),node('middle-a','axiom'),node('middle-b','theorem'),node('outer-a','hypothesis'),node('outer-b','theorem','pending')]){
  const layer=layerForNode(sample),pos=initialNodePosition(sample),radius=pos.length();
  if(layer!=='core'){
    const band=LAYER_BANDS[layer];
    assert(radius>=band.rMin-1e-9&&radius<=band.rMax+1e-9,`${sample.id} outside ${layer} volume`);
    if(Math.abs(pos.z)>radius*.15)sawMeaningfulZ=true;
    assert(pos.distanceTo(initialNodePosition(sample))<1e-12,`${sample.id} layout must be deterministic`);
  }
}
assert(sawMeaningfulZ,'layout regressed toward a flat XY disk');
let positiveZ=0,negativeZ=0;
for(let i=0;i<200;i++){const p=initialNodePosition(node(`volume-${i}`));if(p.z>0)positiveZ++;if(p.z<0)negativeZ++;}
assert(positiveZ>60&&negativeZ>60,'3D distribution must occupy both hemispheres');
assert(clampGraphZoom(0)===MIN_GRAPH_ZOOM,'zoom must clamp at minimum');
assert(clampGraphZoom(999)===MAX_GRAPH_ZOOM,'zoom must clamp at maximum');
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
const phaseA=pendingPulsePhaseMs('pending-a');assert(phaseA===pendingPulsePhaseMs('pending-a'),'pending phase must be deterministic for a node id');
const phases=new Set(['pending-a','pending-b','pending-c','pending-d'].map(pendingPulsePhaseMs));assert(phases.size>1,'pending nodes must not all share the same phase');

const sceneSource=readFileSync('src/ui/scene/KnowledgeScene.ts','utf8');
assert(/const\s+up\s*=/.test(sceneSource),'node tap implementation must remain discoverable');
assert(/const\s+wheel\s*=/.test(sceneSource),'wheel implementation must remain discoverable');
assert(sceneSource.includes('callbacks.onNodeTap(nodeId)'),'node tap must emit exactly through the node-tap callback');
assert(!sceneSource.includes('queueMicrotask'),'node tap must not defer panel dispatch into the microtask queue');
assert(!sceneSource.includes('forceContextLoss'),'scene must never force WebGL context loss');
assert(!sceneSource.includes('forceContextRestore'),'scene must never force context restoration');
assert(!sceneSource.includes('domElement.remove'),'scene lifecycle must keep the renderer canvas attached');
assert(!sceneSource.includes('pointerEvents'),'overlay lifecycle must not retarget the active pointer by mutating canvas hit testing');
assert(/const\s+pauseFrameLoop\s*=/.test(sceneSource),'scene must pause work without destroying GPU state');
assert(/const\s+resumeFrameLoop\s*=/.test(sceneSource),'scene must resume work without recreating GPU state');
assert(/const\s+down\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource),'pointerdown must be gated by scene overlay state');
assert(/const\s+move\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible/.test(sceneSource),'pointermove must be gated by scene overlay state');
assert(/const\s+up\s*=\s*\(e:\s*PointerEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource),'pointerup/pointercancel must be gated by scene overlay state');
assert(/const\s+wheel\s*=\s*\(e:\s*WheelEvent\)\s*=>\s*\{\s*if\s*\(overlayVisible\)\s*return;/.test(sceneSource),'wheel input must be gated by scene overlay state');
assert(/const\s+applyPendingPulse\s*=/.test(sceneSource),'pending pulse implementation must remain discoverable');
assert(!sceneSource.includes('setInterval'),'pending pulse must never create per-node intervals');
assert(/\.group\.scale\.setScalar\(pulse\.scale\)/.test(sceneSource),'pending state must pulse the whole node group, not the mastery glow alone');
assert(/baseShellOpacity\s*\*\s*pulse\.opacityFactor/.test(sceneSource),'pending pulse must fade the node shell');
assert(/basePointOpacity\s*\*\s*pulse\.opacityFactor/.test(sceneSource),'pending pulse must fade the semantic color point');
assert(/baseDotOpacity\s*\*\s*pulse\.opacityFactor/.test(sceneSource),'pending pulse must fade the mastery dot proportionally without changing mastery semantics');
assert(/const\s+pending\s*=\s*!core\s*&&\s*n\.status\s*===\s*'pending'/.test(sceneSource),'only non-core pending nodes may receive the pending pulse');
assert(sceneSource.includes('new THREE.MeshMatcapMaterial'),'ordinary semantic node bodies must use unlit matcap shading so surface depth cannot reintroduce sun-distance darkening');
assert(/const\s+nodeMatcap\s*=/.test(sceneSource),'semantic sphere depth must come from one shared neutral runtime matcap');
assert(/nodeMatcapTex\s*=\s*nodeMatcap\(\)/.test(sceneSource),'ordinary nodes must allocate exactly one shared neutral matcap texture per scene');
assert(/matcap:\s*nodeMatcapTex/.test(sceneSource),'every ordinary semantic shell must consume the same shared matcap so 3D depth stays consistent across node colors');
assert(sceneSource.includes('KNOWLEDGE_SCENE_THEME.node.sphereWidthSegments'),'ordinary sphere geometry must use centralized smoothness settings');
assert(/antialias:\s*KNOWLEDGE_SCENE_THEME\.renderer\.antialias/.test(sceneSource),'renderer antialiasing must be governed by the scene theme');
assert(sceneSource.includes('KNOWLEDGE_SCENE_THEME.renderer.mobilePixelRatio'),'mobile renderer must use the bounded higher-resolution sampling path');
assert(sceneSource.includes('const relationActive = hasSelection && (selectedId === p || selectedId === n.id);'),'only edges directly incident to the clicked node may receive the active relation color');
assert(!sceneSource.includes('n.premises.includes(selectedId!)'),'selecting one premise must not recolor sibling premise edges that do not touch the clicked node');
assert(sceneSource.includes('material.color.setHex(relationActive ? KNOWLEDGE_SCENE_THEME.edge.active : KNOWLEDGE_SCENE_THEME.edge.normal);'),'edge color must switch between the approved ordinary and clicked-node colors');
assert(/\.shell\.visible\s*=\s*true/.test(sceneSource),'large mobile graphs must retain the opaque semantic body instead of falling back to a translucent sprite only');
assert(!sceneSource.includes('r.shell.visible=!largeMobileGraph'),'large-mobile optimization must not hide ordinary semantic shells');
assert(/baseShellOpacity\s*=\s*core\s*\?\s*\.84\s*:\s*KNOWLEDGE_SCENE_THEME\.node\.shellOpacity/.test(sceneSource),'ordinary shell opacity must not depend on status or selection');
assert(!sceneSource.includes("r.baseShellOpacity=(n.status==='falsified'"),'status must not be encoded by making the semantic node body translucent');
assert(/\.point\.visible\s*=\s*!core/.test(sceneSource),'semantic aura must remain available independently of the opaque node body');
assert(/\.point\.scale\.setScalar/.test(sceneSource),'semantic node color must retain a lightweight aura independent of mastery glow');
assert(/pendingNodeIds\.size\s*>\s*0/.test(sceneSource),'large mobile graphs must keep lightweight rendering alive while pending nodes animate');
assert(/const\s+colorFor\s*=\s*\(n:\s*KnowledgeSceneNode\)\s*=>\s*colorForNode\(n\)/.test(sceneSource),'scene rendering must use the canonical status/layer-aware color mapping');
assert(/wireframe:\s*false/.test(sceneSource),'ordinary nodes must render as solid scientific points rather than the old dotted wireframe shells');
assert(sceneSource.includes('KNOWLEDGE_SCENE_THEME.mastery.tint'),'mastery glow must use the centralized neutral tint');
for(const legacy of ['0x62AAA9','0xf0c66e','rgba(134,241,232','rgba(78,200,205'])assert(!sceneSource.includes(legacy),`legacy scene color ${legacy} must not leak back into Three.js rendering`);
console.log('Knowledge scene regression tests passed');
