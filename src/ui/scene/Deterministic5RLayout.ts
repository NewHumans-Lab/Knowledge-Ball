import * as THREE from 'three';
import { isSystemCoreNodeId } from '../../domain/KnowledgeLayerPolicy';
import { lineageRoleFor, topicIdFor, type KnowledgeLineageMeta } from '../../domain/KnowledgeLineage';
import { SUN_ORBIT_RADIUS, SUN_TRIAD_IDS } from '../config/KnowledgeUiConfig';

export const KNOWLEDGE_BALL_RADIUS = 7.2;
export const LAYOUT_UNIT = 5 * KNOWLEDGE_BALL_RADIUS;
export const EXCLUSION_RADIUS = LAYOUT_UNIT;
export const EXPANSION_UNIT = LAYOUT_UNIT;
export const CROSSING_SWEEP_LIMIT = 12;
export const MACRO_DIRECTION_COUNT = 12;
const EPSILON = 1e-7;
const BEAM_WIDTH = 72;
const CANDIDATES_PER_NODE = 24;
const MAX_COMPONENT_EXPANSIONS = 96;

export type SpatialAddress = Readonly<{ shellID: string; cellID: number }>;
export interface LayoutNode {
  id: string; type?: string; premises?: string[]; hidden?: boolean; lineage?: KnowledgeLineageMeta;
  declaredLayer?: 'core'|'inner'|'middle'|'outer'; effectiveLayer?: 'core'|'inner'|'middle'|'outer'; layer?: 'core'|'inner'|'middle'|'outer';
  address?: SpatialAddress; pos?: THREE.Vector3; homePos?: THREE.Vector3; vel?: THREE.Vector3;
}
export type SemanticBoundaries = Readonly<{ cyanBlue:number; bluePurple:number; purpleOuter:null }>;
export type IcosahedralGrid = Readonly<{ shellID:string; radius:number; frequency:number; parentFaces:readonly (readonly [number,number,number])[]; vertices:readonly THREE.Vector3[]; edges:ReadonlySet<string>; degrees:readonly number[]; nearestNeighborDistance:number }>;
export type LayoutDiagnostics = Readonly<{ boundaries:SemanticBoundaries; occupiedCells:ReadonlySet<string>; reservedCells:ReadonlySet<string>; usedAngles:ReadonlyMap<string,number>; componentOrders:ReadonlyMap<string,readonly string[]>; macroCandidateAngles:readonly number[]; macroAssignments:ReadonlyMap<string,number>; expansionCount:number; componentExpansionCounts:ReadonlyMap<string,number>; gridBuildCount:number; grids:ReadonlyMap<string,IcosahedralGrid>; addresses:ReadonlyMap<string,SpatialAddress>; placementOrder:readonly string[] }>;

type Relation={id:string;premises:string[];conclusions:string[]};
type Graph={knowledge:LayoutNode[];relations:Relation[];adjacency:Map<string,Set<string>>;outgoing:Map<string,Set<string>>;incoming:Map<string,Set<string>>};
type Component={id:string;ids:string[];relations:Relation[];branching:number;layers:number;depth:Map<string,number>;orders:Map<number,string[]>};
type Placement={id:string;address:SpatialAddress;position:THREE.Vector3};
type BeamState={placed:Placement[];crossings:number;length:number;key:string};

const ICO_VERTICES=(()=>{const p=(1+Math.sqrt(5))/2;return [[-1,p,0],[1,p,0],[-1,-p,0],[1,-p,0],[0,-1,p],[0,1,p],[0,-1,-p],[0,1,-p],[p,0,-1],[p,0,1],[-p,0,-1],[-p,0,1]].map(v=>new THREE.Vector3(...v).normalize())})();
export const ICOSAHEDRON_FACES:readonly (readonly [number,number,number])[]=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
const vectorKey=(v:THREE.Vector3)=>`${v.x.toFixed(10)}:${v.y.toFixed(10)}:${v.z.toFixed(10)}`;
let activeGridCache:Map<string,IcosahedralGrid>|null=null;
let activeFrequencyCache:Map<string,number>|null=null;
let activeGridBuildCount=0;

function buildGrid(radius:number,frequency:number,shellID:string,validate:boolean):IcosahedralGrid {
  if(radius<=0)throw new Error('ISG radius must be positive');
  if(frequency<1||!Number.isInteger(frequency))throw new Error('ISG frequency must be a positive integer');
  const vertices:THREE.Vector3[]=[]; const canonical=new Map<string,number>(); const edges=new Set<string>();
  const cell=(v:THREE.Vector3)=>{const n=v.normalize(),key=vectorKey(n);let id=canonical.get(key);if(id===undefined){id=vertices.length;canonical.set(key,id);vertices.push(n.multiplyScalar(radius));}return id};
  for(const [ai,bi,ci] of ICOSAHEDRON_FACES){const a=ICO_VERTICES[ai]!,b=ICO_VERTICES[bi]!,c=ICO_VERTICES[ci]!,local=new Map<string,number>();
    for(let i=0;i<=frequency;i++)for(let j=0;j<=frequency-i;j++){const k=frequency-i-j;local.set(`${i}:${j}`,cell(a.clone().multiplyScalar(i).addScaledVector(b,j).addScaledVector(c,k)))}
    const link=(i:number,j:number,x:number,y:number)=>{const u=local.get(`${i}:${j}`),v=local.get(`${x}:${y}`);if(u!==undefined&&v!==undefined)edges.add(edgeKey(u,v))};
    for(let i=0;i<=frequency;i++)for(let j=0;j<=frequency-i;j++){link(i,j,i+1,j);link(i,j,i,j+1);link(i,j,i+1,j-1)}
  }
  const degrees=vertices.map(()=>0);let nearest=Infinity;for(const key of edges){const [a,b]=key.split(':').map(Number);degrees[a]++;degrees[b]++;nearest=Math.min(nearest,vertices[a]!.distanceTo(vertices[b]!))}
  const grid=Object.freeze({shellID,radius,frequency,parentFaces:ICOSAHEDRON_FACES,vertices,edges,degrees,nearestNeighborDistance:nearest});
  if(validate&&nearest+EPSILON<LAYOUT_UNIT)throw new Error(`Illegal ISG spacing on ${shellID}`);
  activeGridBuildCount++;
  return grid;
}

/** Select the densest subdivision whose shortest spherical chord respects 5R. */
export function selectSubdivisionFrequency(radius:number):number {
  if(radius<=0)throw new Error('ISG radius must be positive');
  const radiusKey=radius.toFixed(9),known=activeFrequencyCache?.get(radiusKey);if(known!==undefined)return known;
  // Icosahedron edge chord is about 1.05146r. Start at its spacing estimate and
  // probe only adjacent frequencies; constructing a frequency-64 grid merely to
  // discover that a small shell needs frequency 2 stalls browser startup.
  let frequency=Math.max(1,Math.min(128,Math.floor(radius*1.05146/LAYOUT_UNIT)));
  while(frequency>1&&buildGrid(radius,frequency,`probe:${radius}:${frequency}`,false).nearestNeighborDistance+EPSILON<LAYOUT_UNIT)frequency--;
  while(frequency<128&&buildGrid(radius,frequency+1,`probe:${radius}:${frequency+1}`,false).nearestNeighborDistance+EPSILON>=LAYOUT_UNIT)frequency++;
  activeFrequencyCache?.set(radiusKey,frequency);return frequency;
}

/** Build a class-I geodesic grid; a layout run interns identical radius/frequency geometry. */
export function generateIcosahedralGrid(radius:number,frequency?:number,shellID=`shell:${radius.toFixed(6)}`,validate=true):IcosahedralGrid {
  const f=frequency??selectSubdivisionFrequency(radius),key=`${radius.toFixed(9)}:${f}`;
  const cached=activeGridCache?.get(key);
  if(cached)return cached.shellID===shellID?cached:Object.freeze({...cached,shellID});
  const grid=buildGrid(radius,f,shellID,validate);activeGridCache?.set(key,grid);return grid;
}

function layerOf(n:LayoutNode){return n.effectiveLayer==='outer'||n.layer==='outer'||n.declaredLayer==='outer'?'outer':n.effectiveLayer==='middle'||n.layer==='middle'||n.declaredLayer==='middle'?'middle':'inner'}
function visibleKnowledge(nodes:readonly LayoutNode[]){return nodes.filter(n=>n.type!=='reasoning'&&!isSystemCoreNodeId(n.id)&&(!n.hidden||!!n.lineage))}
function capacityAt(radius:number){const f=selectSubdivisionFrequency(radius);return 10*f*f+2}
export function computeSemanticBoundaries(nodes:readonly LayoutNode[]):SemanticBoundaries{
  const g=buildGraph([...nodes]),componentsMeta=metadata(g),knowledge=visibleKnowledge(nodes),counts=(layer:string)=>knowledge.filter(n=>layerOf(n)===layer).length;
  const realDepth=Math.max(1,...componentsMeta.map(c=>Math.max(...c.depth.values())+1));
  const radius=(count:number,min:number)=>{let r=Math.max(min,realDepth*LAYOUT_UNIT);while(capacityAt(r)<count)r+=LAYOUT_UNIT;return r};
  const cyanBlue=radius(counts('inner'),LAYOUT_UNIT),bluePurple=radius(counts('middle'),cyanBlue+2*LAYOUT_UNIT);
  return Object.freeze({cyanBlue,bluePurple,purpleOuter:null});
}
function setPosition(n:LayoutNode,p:THREE.Vector3){n.pos=p.clone();n.homePos=p.clone();n.vel??=new THREE.Vector3();n.vel.set(0,0,0)}
function buildGraph(nodes:LayoutNode[]):Graph{
  const knowledge=visibleKnowledge(nodes),ids=new Set(knowledge.map(n=>n.id));
  const relations=nodes.filter(n=>n.type==='reasoning').map(n=>({id:n.id,premises:[...new Set(n.premises??[])].filter(x=>ids.has(x)).sort(),conclusions:knowledge.filter(k=>k.premises?.includes(n.id)).map(k=>k.id).sort()})).filter(r=>r.premises.length||r.conclusions.length);
  const adjacency=new Map(knowledge.map(n=>[n.id,new Set<string>()])),outgoing=new Map(knowledge.map(n=>[n.id,new Set<string>()])),incoming=new Map(knowledge.map(n=>[n.id,new Set<string>()]));
  const connect=(a:string,b:string)=>{if(a===b||!ids.has(a)||!ids.has(b))return;adjacency.get(a)!.add(b);adjacency.get(b)!.add(a);outgoing.get(a)!.add(b);incoming.get(b)!.add(a)};
  for(const r of relations)for(const a of r.premises)for(const b of r.conclusions)connect(a,b);
  for(const n of knowledge)for(const p of n.premises??[])connect(p,n.id);
  // Lineage is presentation-related but still one spatial component, never free-float.
  const topics=new Map<string,LayoutNode[]>();for(const n of knowledge)if(n.lineage){const a=topics.get(topicIdFor(n))??[];a.push(n);topics.set(topicIdFor(n),a)}
  for(const a of topics.values()){const current=a.find(n=>lineageRoleFor(n)==='current'&&n.lineage?.reasoningSide!=='opposition')??a[0];if(current)for(const n of a)if(n!==current)connect(current.id,n.id)}
  return{knowledge,relations,adjacency,outgoing,incoming};
}
function components(g:Graph){const seen=new Set<string>(),result:string[][]=[];for(const seed of g.knowledge.map(n=>n.id).sort()){if(seen.has(seed))continue;const q=[seed],ids:string[]=[];seen.add(seed);for(let i=0;i<q.length;i++){const id=q[i]!;ids.push(id);for(const x of [...(g.adjacency.get(id)??[])].sort())if(!seen.has(x)){seen.add(x);q.push(x)}}result.push(ids.sort())}return result}
function depths(ids:string[],g:Graph){const set=new Set(ids),ind=new Map<string,number>(),d=new Map<string,number>();for(const id of ids){const n=[...(g.incoming.get(id)??[])].filter(x=>set.has(x)).length;ind.set(id,n);if(!n)d.set(id,0)}const q=ids.filter(x=>ind.get(x)===0).sort();for(let i=0;i<q.length;i++){const a=q[i]!;for(const b of [...(g.outgoing.get(a)??[])].filter(x=>set.has(x)).sort()){d.set(b,Math.max(d.get(b)??0,(d.get(a)??0)+1));ind.set(b,ind.get(b)!-1);if(!ind.get(b))q.push(b)}}for(const id of ids)if(!d.has(id))d.set(id,Math.max(0,...d.values())+1);return d}
function metadata(g:Graph):Component[]{const byId=new Map(g.knowledge.map(n=>[n.id,n]));return components(g).map(ids=>{const d=depths(ids,g),orders=new Map<number,string[]>();for(const id of ids){const a=orders.get(d.get(id)!)??[];a.push(id);orders.set(d.get(id)!,a)}for(const a of orders.values())a.sort();const set=new Set(ids),relations=g.relations.filter(r=>[...r.premises,...r.conclusions].some(x=>set.has(x)));return{id:ids[0]!,ids,relations,branching:relations.reduce((s,r)=>s+Math.max(0,r.premises.length+r.conclusions.length-2),0),layers:new Set(ids.map(id=>layerOf(byId.get(id)!))).size,depth:d,orders}})}
const hardness=(a:Component,b:Component)=>b.ids.length-a.ids.length||b.layers-a.layers||b.branching-a.branching||a.id.localeCompare(b.id);
function candidateCells(grid:IcosahedralGrid,direction:THREE.Vector3){return grid.vertices.map((v,i)=>({i,d:v.clone().normalize().dot(direction)})).sort((a,b)=>b.d-a.d||a.i-b.i).map(x=>x.i)}
function addressKey(a:SpatialAddress){return `${a.shellID}:${a.cellID}`}
function stableDirection(componentId:string,grid:IcosahedralGrid){let h=2166136261;for(const c of componentId){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return grid.vertices[(h>>>0)%grid.vertices.length]!.clone().normalize()}
function radialFor(n:LayoutNode,depth:number,c:Component,b:SemanticBoundaries,extra:number){const outer=c.ids.filter(id=>layerOf(nodeMap.get(id)!)==='outer').sort((a,z)=>c.depth.get(a)!-c.depth.get(z)!||a.localeCompare(z));if(outer.length)return b.bluePurple+(depth-c.depth.get(outer[0]!)!)*LAYOUT_UNIT+extra;const inner=c.ids.filter(id=>layerOf(nodeMap.get(id)!)==='inner').sort((a,z)=>c.depth.get(a)!-c.depth.get(z)!||a.localeCompare(z));if(inner.length&&c.ids.some(id=>layerOf(nodeMap.get(id)!)==='middle'))return b.cyanBlue+(depth-c.depth.get(inner[0]!)!)*LAYOUT_UNIT+extra;return Math.max(LAYOUT_UNIT,(layerOf(n)==='middle'?b.cyanBlue:layerOf(n)==='outer'?b.bluePurple:LAYOUT_UNIT)+depth*LAYOUT_UNIT+extra)}
let nodeMap=new Map<string,LayoutNode>();

type CrossingEdge=readonly [string,string];
function relationEdges(g:Graph,ids?:Set<string>):CrossingEdge[]{const result:CrossingEdge[]=[];for(const [a,outs] of g.outgoing)for(const b of outs)if(!ids||ids.has(a)&&ids.has(b))result.push([a,b]);return result.sort((x,y)=>x[0].localeCompare(y[0])||x[1].localeCompare(y[1]))}
function orient(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
function projected(v:THREE.Vector3,axis:THREE.Vector3){const up=Math.abs(axis.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0),x=new THREE.Vector3().crossVectors(up,axis).normalize(),y=new THREE.Vector3().crossVectors(axis,x).normalize();return new THREE.Vector2(v.dot(x),v.dot(y))}
/** Counts proper relation-segment intersections after deterministic tangent-plane projection. */
export function countLayerCrossings(positions:ReadonlyMap<string,THREE.Vector3>=new Map(),edges:readonly CrossingEdge[]=[]):number{
  if(edges.length<2)return 0;const mean=[...positions.values()].reduce((s,p)=>s.add(p.clone().normalize()),new THREE.Vector3());if(mean.lengthSq()<EPSILON)mean.set(0,0,1);mean.normalize();let count=0;
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const [a,b]=edges[i]!,[c,d]=edges[j]!;if(a===c||a===d||b===c||b===d)continue;const pa=positions.get(a),pb=positions.get(b),pc=positions.get(c),pd=positions.get(d);if(!pa||!pb||!pc||!pd)continue;const A=projected(pa,mean),B=projected(pb,mean),C=projected(pc,mean),D=projected(pd,mean);if(orient(A,B,C)*orient(A,B,D)<-EPSILON&&orient(C,D,A)*orient(C,D,B)<-EPSILON)count++}
  return count;
}
function scoreState(placed:Placement[],edges:readonly CrossingEdge[]):Omit<BeamState,'placed'>{const p=new Map(placed.map(x=>[x.id,x.position])),complete=edges.filter(([a,b])=>p.has(a)&&p.has(b)),crossings=countLayerCrossings(p,complete),length=complete.reduce((s,[a,b])=>s+p.get(a)!.distanceTo(p.get(b)!),0),key=placed.map(x=>`${x.address.shellID}:${String(x.address.cellID).padStart(6,'0')}`).join('|');return{crossings,length,key}}
function compareState(a:BeamState,b:BeamState){return a.crossings-b.crossings||a.length-b.length||a.key.localeCompare(b.key)}
function graphAwareOrder(c:Component,g:Graph){const depthsSorted=[...c.orders].sort(([a],[b])=>a-b),rank=new Map<string,number>(),answer:string[]=[];for(const [,ids] of depthsSorted){const sorted=[...ids].sort((a,b)=>{const neighborRank=(id:string)=>[...(g.incoming.get(id)??[]),...(g.outgoing.get(id)??[])].filter(x=>rank.has(x)).reduce((s,x)=>s+rank.get(x)!,0)/Math.max(1,[...(g.incoming.get(id)??[]),...(g.outgoing.get(id)??[])].filter(x=>rank.has(x)).length);return neighborRank(a)-neighborRank(b)||a.localeCompare(b)});sorted.forEach((id,i)=>rank.set(id,i));answer.push(...sorted)}return answer}
function searchComponent(c:Component,g:Graph,b:SemanticBoundaries,extra:number,occupied:ReadonlyMap<string,THREE.Vector3>,grids:Map<string,IcosahedralGrid>):Placement[]|null{
  const primaryRadius=radialFor(nodeMap.get(c.ids[0]!)!,c.depth.get(c.ids[0]!)!,c,b,extra),primaryShell=`shell:${primaryRadius.toFixed(6)}`;
  let directionGrid=grids.get(primaryShell);if(!directionGrid){directionGrid=generateIcosahedralGrid(primaryRadius,undefined,primaryShell);grids.set(primaryShell,directionGrid)}const direction=stableDirection(c.id,directionGrid),edges=relationEdges(g,new Set(c.ids));let beam:BeamState[]=[{placed:[],crossings:0,length:0,key:''}];
  for(const id of graphAwareOrder(c,g)){const n=nodeMap.get(id)!,radius=radialFor(n,c.depth.get(id)!,c,b,extra),shellID=`shell:${radius.toFixed(6)}`;let grid=grids.get(shellID);if(!grid){grid=generateIcosahedralGrid(radius,undefined,shellID);grids.set(shellID,grid)}const candidates=candidateCells(grid,direction),next:BeamState[]=[];
    for(const state of beam){let accepted=0;for(const cellID of candidates){const position=grid.vertices[cellID]!;if([...occupied.values()].some(p=>p.distanceTo(position)<LAYOUT_UNIT-EPSILON)||state.placed.some(p=>p.position.distanceTo(position)<LAYOUT_UNIT-EPSILON))continue;const placed=[...state.placed,{id,address:{shellID,cellID},position:position.clone()}],score=scoreState(placed,edges);next.push({placed,...score});if(++accepted>=CANDIDATES_PER_NODE)break}}
    if(!next.length)return null;next.sort(compareState);beam=next.slice(0,BEAM_WIDTH);
  }
  return beam.sort(compareState)[0]!.placed;
}
function placeReasoning(nodes:LayoutNode[],g:Graph){const by=new Map(nodes.map(n=>[n.id,n]));for(const r of g.relations){const n=by.get(r.id);if(!n||!r.premises.length||!r.conclusions.length)continue;const mean=(ids:string[])=>ids.reduce((s,id)=>s.add(by.get(id)?.pos??new THREE.Vector3()),new THREE.Vector3()).multiplyScalar(1/ids.length);setPosition(n,mean(r.premises).add(mean(r.conclusions)).multiplyScalar(.5));delete n.address}}
function signature(nodes:readonly LayoutNode[]){return [...nodes].sort((a,b)=>a.id.localeCompare(b.id)).map(n=>`${n.id}:${n.type}:${[...(n.premises??[])].sort()}:${n.effectiveLayer??n.layer??n.declaredLayer}:${n.hidden}:${n.lineage?.topicId}:${n.lineage?.role}:${n.lineage?.reasoningSide}`).join('|')}

export function applyDeterministic5RLayout<T extends LayoutNode>(nodes:T[]):T[]{
  const sig=signature(nodes);if(cache?.signature===sig){for(const n of nodes){const p=cache.positions.get(n.id),a=cache.addresses.get(n.id);if(p)setPosition(n,p);if(a)n.address=a}lastDiagnostics=cache.diagnostics;return nodes}
  activeGridCache=new Map();activeFrequencyCache=new Map();activeGridBuildCount=0;const g=buildGraph(nodes);nodeMap=new Map(nodes.map(n=>[n.id,n]));const boundaries=computeSemanticBoundaries(nodes),complex=metadata(g).sort(hardness),ordered=[...complex.filter(c=>c.ids.length>1),...complex.filter(c=>c.ids.length===1)],occupied=new Map<string,THREE.Vector3>(),grids=new Map<string,IcosahedralGrid>(),addresses=new Map<string,SpatialAddress>(),orders=new Map<string,readonly string[]>(),used=new Map<string,number>(),componentExpansionCounts=new Map<string,number>();let expansionCount=0;
  // Inputs are mutated only after a complete component solution exists. A failed search
  // therefore leaves both authoritative addresses and occupancy at the previous commit.
  for(const c of ordered){let assignment:Placement[]|null=null,attempt=0;for(;attempt<=MAX_COMPONENT_EXPANSIONS&&!assignment;attempt++)assignment=searchComponent(c,g,boundaries,attempt*EXPANSION_UNIT,occupied,grids);if(!assignment)throw new Error(`ISG expansion exhausted for component ${c.id}`);const expansions=Math.max(0,attempt-1);componentExpansionCounts.set(c.id,expansions);expansionCount+=expansions;
    for(const x of assignment){occupied.set(addressKey(x.address),x.position);addresses.set(x.id,x.address)}orders.set(c.id,graphAwareOrder(c,g));const first=assignment[0];if(first)used.set(c.id,first.address.cellID);
  }
  // Atomic final commit: all visible Knowledge, including lineage/opposition, receives an ISG address.
  for(const [id,address] of addresses){const n=nodeMap.get(id)!,grid=grids.get(address.shellID)!;n.address=address;setPosition(n,grid.vertices[address.cellID]!)}
  for(const n of nodes.filter(n=>isSystemCoreNodeId(n.id))){const i=Math.max(0,SUN_TRIAD_IDS.indexOf(n.id as never)),a=i*Math.PI*2/SUN_TRIAD_IDS.length;setPosition(n,new THREE.Vector3(Math.cos(a)*SUN_ORBIT_RADIUS,Math.sin(a)*SUN_ORBIT_RADIUS,0));delete n.address}placeReasoning(nodes,g);
  lastDiagnostics=Object.freeze({boundaries,occupiedCells:new Set(occupied.keys()),reservedCells:new Set(occupied.keys()),usedAngles:used,componentOrders:orders,macroCandidateAngles:[],macroAssignments:new Map(),expansionCount,componentExpansionCounts,gridBuildCount:activeGridBuildCount,grids,addresses,placementOrder:ordered.map(c=>c.id)});cache={signature:sig,positions:new Map(nodes.filter(n=>n.pos).map(n=>[n.id,n.pos!.clone()])),addresses:new Map(addresses),diagnostics:lastDiagnostics};activeGridCache=null;activeFrequencyCache=null;return nodes;
}
let lastDiagnostics:LayoutDiagnostics|null=null;let cache:{signature:string;positions:Map<string,THREE.Vector3>;addresses:Map<string,SpatialAddress>;diagnostics:LayoutDiagnostics}|null=null;
export function getLastLayoutDiagnostics(){return lastDiagnostics}
export function positionsCollide(a:THREE.Vector3,b:THREE.Vector3){return a.distanceTo(b)<LAYOUT_UNIT-EPSILON}
export function icosahedronMacroDirections(){return ICO_VERTICES.map(v=>v.clone())}
export function compactTriangularCoordinates(count:number){return Array.from({length:count},(_,i)=>[i,0] as [number,number])}
