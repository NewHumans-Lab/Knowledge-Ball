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
const PROJECTION_CANDIDATE_COUNT = 7;
const CANDIDATE_PATH_WIDTH = 24;

export type SpatialAddress = Readonly<{ shellID: string; cellID: number }>;
export interface LayoutNode {
  id: string;
  type?: string;
  premises?: string[];
  hidden?: boolean;
  lineage?: KnowledgeLineageMeta;
  declaredLayer?: 'core'|'inner'|'middle'|'outer';
  effectiveLayer?: 'core'|'inner'|'middle'|'outer';
  layer?: 'core'|'inner'|'middle'|'outer';
  address?: SpatialAddress;
  pos?: THREE.Vector3;
  homePos?: THREE.Vector3;
  vel?: THREE.Vector3;
}
export type SemanticBoundaries = Readonly<{ cyanBlue:number; bluePurple:number; purpleOuter:null }>;
export type IcosahedralGrid = Readonly<{
  shellID:string;
  radius:number;
  frequency:number;
  parentFaces:readonly (readonly [number,number,number])[];
  vertices:readonly THREE.Vector3[];
  edges:ReadonlySet<string>;
  degrees:readonly number[];
  nearestNeighborDistance:number;
}>;
export type LayoutFootprintPlacement = Readonly<{ id:string; address:SpatialAddress; position:THREE.Vector3 }>;
export type LayoutFootprintPlanner = (context:Readonly<{
  anchor:LayoutNode;
  grid:IcosahedralGrid;
  cellID:number;
  occupied:ReadonlyMap<string,THREE.Vector3>;
  placed:ReadonlyMap<string,LayoutFootprintPlacement>;
}>)=>readonly LayoutFootprintPlacement[]|null;
export type DeterministicLayoutOptions = Readonly<{
  footprintPlanner?:LayoutFootprintPlanner;
  footprintSignature?:string;
}>;
export type LayoutDiagnostics = Readonly<{
  boundaries:SemanticBoundaries;
  occupiedCells:ReadonlySet<string>;
  reservedCells:ReadonlySet<string>;
  usedAngles:ReadonlyMap<string,number>;
  componentOrders:ReadonlyMap<string,readonly string[]>;
  macroCandidateAngles:readonly number[];
  macroAssignments:ReadonlyMap<string,number>;
  expansionCount:number;
  componentExpansionCounts:ReadonlyMap<string,number>;
  gridBuildCount:number;
  grids:ReadonlyMap<string,IcosahedralGrid>;
  addresses:ReadonlyMap<string,SpatialAddress>;
  placementOrder:readonly string[];
  componentInitialLineLengths:ReadonlyMap<string,number>;
  componentLineLengths:ReadonlyMap<string,number>;
  componentOptimizationPasses:ReadonlyMap<string,number>;
  directionSwitchCounts:ReadonlyMap<string,number>;
  componentDirectionLevels:ReadonlyMap<string,number>;
  componentDirectionSlots:ReadonlyMap<string,number>;
  boundaryRemappedComponents:ReadonlySet<string>;
  boundaryShiftByComponent:ReadonlyMap<string,number>;
}>;

type CrossingEdge=readonly [string,string];
type Relation={id:string;premises:string[];conclusions:string[]};
type Graph={
  knowledge:LayoutNode[];
  relations:Relation[];
  adjacency:Map<string,Set<string>>;
  outgoing:Map<string,Set<string>>;
  incoming:Map<string,Set<string>>;
  realEdges:CrossingEdge[];
};
type Component={
  id:string;
  ids:string[];
  relations:Relation[];
  branching:number;
  layers:number;
  depth:Map<string,number>;
  orders:Map<number,string[]>;
};
type Placement=LayoutFootprintPlacement;
type SemanticLayer='inner'|'middle'|'outer';
type ShellGroup={shellID:string;radius:number;grid:IcosahedralGrid;ids:string[];depth:number};
type DirectionSolution={
  placed:Placement[];
  initialLength:number;
  length:number;
  passes:number;
  directionCellID:number;
  directionLevel:number;
  directionSlot:number;
};
type SearchAttempt={solution:DirectionSolution|null;directionSwitches:number;level:number};
type CandidatePath={placed:Placement[];byId:Map<string,Placement>;lineLength:number;guide:number;tie:string};
type DirectionAllocator={used:Map<number,Set<number>>};
type CachedComponentState=Readonly<{signature:string;ids:readonly string[]}>;
type NodeSpatialSnapshot=Readonly<{address?:SpatialAddress;pos?:THREE.Vector3;homePos?:THREE.Vector3;vel?:THREE.Vector3}>;
type LayoutCache={
  signature:string;
  boundaries:SemanticBoundaries;
  positions:Map<string,THREE.Vector3>;
  addresses:Map<string,SpatialAddress>;
  diagnostics:LayoutDiagnostics;
  components:Map<string,CachedComponentState>;
};

const ICO_VERTICES=(()=>{
  const p=(1+Math.sqrt(5))/2;
  return [[-1,p,0],[1,p,0],[-1,-p,0],[1,-p,0],[0,-1,p],[0,1,p],[0,-1,-p],[0,1,-p],[p,0,-1],[p,0,1],[-p,0,-1],[-p,0,1]]
    .map(v=>new THREE.Vector3(...v).normalize());
})();
export const ICOSAHEDRON_FACES:readonly (readonly [number,number,number])[]=[
  [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
  [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
];
const BALANCED_ICO_ORDER=Object.freeze([0,3,8,11,5,6,1,2,9,10,4,7]);
const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
const vectorKey=(v:THREE.Vector3)=>`${v.x.toFixed(10)}:${v.y.toFixed(10)}:${v.z.toFixed(10)}`;
const stableHash=(text:string)=>{let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
let activeGridCache:Map<string,IcosahedralGrid>|null=null;
let activeFrequencyCache:Map<string,number>|null=null;
let activeGridBuildCount=0;
const allDirectionCache=new Map<number,readonly THREE.Vector3[]>();
const directionLevelCache=new Map<number,readonly THREE.Vector3[]>();

function buildGrid(radius:number,frequency:number,shellID:string,validate:boolean):IcosahedralGrid {
  if(radius<=0)throw new Error('ISG radius must be positive');
  if(frequency<1||!Number.isInteger(frequency))throw new Error('ISG frequency must be a positive integer');
  const vertices:THREE.Vector3[]=[];
  const canonical=new Map<string,number>();
  const edges=new Set<string>();
  const cell=(v:THREE.Vector3)=>{
    const n=v.normalize(),key=vectorKey(n);
    let id=canonical.get(key);
    if(id===undefined){id=vertices.length;canonical.set(key,id);vertices.push(n.multiplyScalar(radius));}
    return id;
  };
  for(const [ai,bi,ci] of ICOSAHEDRON_FACES){
    const a=ICO_VERTICES[ai]!,b=ICO_VERTICES[bi]!,c=ICO_VERTICES[ci]!,local=new Map<string,number>();
    for(let i=0;i<=frequency;i++)for(let j=0;j<=frequency-i;j++){
      const k=frequency-i-j;
      local.set(`${i}:${j}`,cell(a.clone().multiplyScalar(i).addScaledVector(b,j).addScaledVector(c,k)));
    }
    const link=(i:number,j:number,x:number,y:number)=>{
      const u=local.get(`${i}:${j}`),v=local.get(`${x}:${y}`);
      if(u!==undefined&&v!==undefined)edges.add(edgeKey(u,v));
    };
    for(let i=0;i<=frequency;i++)for(let j=0;j<=frequency-i;j++){
      link(i,j,i+1,j);link(i,j,i,j+1);link(i,j,i+1,j-1);
    }
  }
  const degrees=vertices.map(()=>0);
  let nearest=Infinity;
  for(const key of edges){
    const [a,b]=key.split(':').map(Number);
    degrees[a]++;degrees[b]++;
    nearest=Math.min(nearest,vertices[a]!.distanceTo(vertices[b]!));
  }
  const grid=Object.freeze({shellID,radius,frequency,parentFaces:ICOSAHEDRON_FACES,vertices,edges,degrees,nearestNeighborDistance:nearest});
  if(validate&&nearest+EPSILON<LAYOUT_UNIT)throw new Error(`Illegal ISG spacing on ${shellID}`);
  activeGridBuildCount++;
  return grid;
}

export function selectSubdivisionFrequency(radius:number):number {
  if(radius<=0)throw new Error('ISG radius must be positive');
  const radiusKey=radius.toFixed(9),known=activeFrequencyCache?.get(radiusKey);
  if(known!==undefined)return known;
  let frequency=Math.max(1,Math.floor(radius*1.05146/LAYOUT_UNIT));
  while(frequency>1&&buildGrid(radius,frequency,`probe:${radius}:${frequency}`,false).nearestNeighborDistance+EPSILON<LAYOUT_UNIT)frequency--;
  while(buildGrid(radius,frequency+1,`probe:${radius}:${frequency+1}`,false).nearestNeighborDistance+EPSILON>=LAYOUT_UNIT)frequency++;
  activeFrequencyCache?.set(radiusKey,frequency);
  return frequency;
}

export function generateIcosahedralGrid(radius:number,frequency?:number,shellID=`shell:${radius.toFixed(6)}`,validate=true):IcosahedralGrid {
  const f=frequency??selectSubdivisionFrequency(radius),key=`${radius.toFixed(9)}:${f}`;
  const cached=activeGridCache?.get(key);
  if(cached)return cached.shellID===shellID?cached:Object.freeze({...cached,shellID});
  const grid=buildGrid(radius,f,shellID,validate);
  activeGridCache?.set(key,grid);
  return grid;
}

function buildDirectionVertices(level:number):readonly THREE.Vector3[]{
  if(level<0||!Number.isInteger(level))throw new Error('Direction level must be a non-negative integer');
  const cached=allDirectionCache.get(level);
  if(cached)return cached;
  const frequency=2**level;
  const canonical=new Map<string,THREE.Vector3>();
  for(const [ai,bi,ci] of ICOSAHEDRON_FACES){
    const a=ICO_VERTICES[ai]!,b=ICO_VERTICES[bi]!,c=ICO_VERTICES[ci]!;
    for(let i=0;i<=frequency;i++)for(let j=0;j<=frequency-i;j++){
      const k=frequency-i-j;
      const direction=a.clone().multiplyScalar(i).addScaledVector(b,j).addScaledVector(c,k).normalize();
      canonical.set(vectorKey(direction),direction);
    }
  }
  const result=Object.freeze([...canonical.values()].map(v=>v.clone()));
  allDirectionCache.set(level,result);
  return result;
}

function balancedAddedDirectionOrder(directions:readonly THREE.Vector3[],level:number):readonly THREE.Vector3[]{
  const byKey=new Map(directions.map(v=>[vectorKey(v),v]));
  const visited=new Set<string>();
  const pairs:{key:string;first:THREE.Vector3;second:THREE.Vector3;rank:number}[]=[];
  const singles:{key:string;value:THREE.Vector3;rank:number}[]=[];
  for(const v of directions){
    const key=vectorKey(v);
    if(visited.has(key))continue;
    const oppositeKey=vectorKey(v.clone().multiplyScalar(-1)),opposite=byKey.get(oppositeKey);
    if(opposite){
      visited.add(key);visited.add(oppositeKey);
      const firstKey=key<oppositeKey?key:oppositeKey;
      const first=key<oppositeKey?v:opposite,second=key<oppositeKey?opposite:v;
      pairs.push({key:firstKey,first,second,rank:stableHash(`${level}:${firstKey}`)});
    }else{
      visited.add(key);
      singles.push({key,value:v,rank:stableHash(`${level}:${key}`)});
    }
  }
  pairs.sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key));
  singles.sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key));
  return Object.freeze([...pairs.flatMap(pair=>[pair.first.clone(),pair.second.clone()]),...singles.map(x=>x.value.clone())]);
}

export function directionLevelSize(level:number):number {
  if(level<0||!Number.isInteger(level))throw new Error('Direction level must be a non-negative integer');
  return level===0?12:30*(4**(level-1));
}

/**
 * Direction levels are incremental, not cumulative: 12, then +30, +120, +480 ...
 * A finer level is opened only after every slot in the current level is already owned.
 */
export function directionLevelDirections(level:number):readonly THREE.Vector3[]{
  const cached=directionLevelCache.get(level);
  if(cached)return cached;
  let result:readonly THREE.Vector3[];
  if(level===0){
    result=Object.freeze(BALANCED_ICO_ORDER.map(i=>ICO_VERTICES[i]!.clone()));
  }else{
    const previous=new Set(buildDirectionVertices(level-1).map(vectorKey));
    const added=buildDirectionVertices(level).filter(v=>!previous.has(vectorKey(v)));
    result=balancedAddedDirectionOrder(added,level);
  }
  if(result.length!==directionLevelSize(level))throw new Error(`Direction level ${level} cardinality mismatch: ${result.length}`);
  directionLevelCache.set(level,result);
  return result;
}

function layerOf(n:LayoutNode):SemanticLayer {
  return n.effectiveLayer==='outer'||n.layer==='outer'||n.declaredLayer==='outer'?'outer':
    n.effectiveLayer==='middle'||n.layer==='middle'||n.declaredLayer==='middle'?'middle':'inner';
}
function visibleKnowledge(nodes:readonly LayoutNode[]){return nodes.filter(n=>n.type!=='reasoning'&&!isSystemCoreNodeId(n.id)&&(!n.hidden||!!n.lineage))}
function capacityAt(radius:number){const f=selectSubdivisionFrequency(radius);return 10*f*f+2}
function capacityRequirement(width:number){if(width<=0)return 0;let radius=LAYOUT_UNIT;while(capacityAt(radius)<width)radius+=LAYOUT_UNIT;return radius}
function componentLayerDepths(c:Component,layer:SemanticLayer){return c.ids.filter(id=>layerOf(nodeMapForSizing.get(id)!)===layer).map(id=>c.depth.get(id)!).sort((a,b)=>a-b)}
let nodeMapForSizing=new Map<string,LayoutNode>();
function layerChainRequirement(layer:SemanticLayer,componentsMeta:readonly Component[]){
  let units=0;
  for(const c of componentsMeta){
    const own=componentLayerDepths(c,layer);
    if(!own.length)continue;
    if(layer==='inner')units=Math.max(units,own[own.length-1]!-own[0]!+1);
    else if(layer==='middle'){
      const inner=componentLayerDepths(c,'inner'),outer=componentLayerDepths(c,'outer');
      const start=inner.length?inner[0]!:own[0]!,end=outer.length?outer[0]!:own[own.length-1]!;
      units=Math.max(units,Math.max(1,end-start));
    }
  }
  return units*LAYOUT_UNIT;
}
function layerPeakDepthWidth(layer:SemanticLayer,componentsMeta:readonly Component[]){
  const widths=new Map<number,number>();
  for(const c of componentsMeta){
    const own=componentLayerDepths(c,layer);
    if(!own.length)continue;
    const origin=own[0]!;
    for(const depth of own){const localDepth=depth-origin;widths.set(localDepth,(widths.get(localDepth)??0)+1);}
  }
  return Math.max(0,...widths.values());
}
function layerRadiusRequirement(layer:SemanticLayer,componentsMeta:readonly Component[]){return Math.max(layerChainRequirement(layer,componentsMeta),capacityRequirement(layerPeakDepthWidth(layer,componentsMeta)))}
export function computeSemanticBoundaries(nodes:readonly LayoutNode[]):SemanticBoundaries {
  const g=buildGraph([...nodes]),componentsMeta=metadata(g);
  nodeMapForSizing=new Map(g.knowledge.map(n=>[n.id,n]));
  const cyanBlue=Math.max(LAYOUT_UNIT,layerRadiusRequirement('inner',componentsMeta));
  const blueThickness=layerRadiusRequirement('middle',componentsMeta);
  return Object.freeze({cyanBlue,bluePurple:cyanBlue+blueThickness,purpleOuter:null});
}
function setPosition(n:LayoutNode,p:THREE.Vector3){n.pos=p.clone();n.homePos=p.clone();n.vel??=new THREE.Vector3();n.vel.set(0,0,0)}

function buildGraph(nodes:LayoutNode[]):Graph {
  const knowledge=visibleKnowledge(nodes),ids=new Set(knowledge.map(n=>n.id)),realEdgeKeys=new Set<string>();
  const relations=nodes.filter(n=>n.type==='reasoning').map(n=>({
    id:n.id,
    premises:[...new Set(n.premises??[])].filter(x=>ids.has(x)).sort(),
    conclusions:knowledge.filter(k=>k.premises?.includes(n.id)).map(k=>k.id).sort(),
  })).filter(r=>r.premises.length||r.conclusions.length);
  const adjacency=new Map(knowledge.map(n=>[n.id,new Set<string>()]));
  const outgoing=new Map(knowledge.map(n=>[n.id,new Set<string>()]));
  const incoming=new Map(knowledge.map(n=>[n.id,new Set<string>()]));
  const connect=(a:string,b:string,real=true)=>{
    if(a===b||!ids.has(a)||!ids.has(b))return;
    adjacency.get(a)!.add(b);adjacency.get(b)!.add(a);outgoing.get(a)!.add(b);incoming.get(b)!.add(a);
    if(real)realEdgeKeys.add(`${a}\u0000${b}`);
  };
  for(const r of relations)for(const a of r.premises)for(const b of r.conclusions)connect(a,b,true);
  for(const n of knowledge)for(const p of n.premises??[])connect(p,n.id,true);
  const topics=new Map<string,LayoutNode[]>();
  for(const n of knowledge)if(n.lineage){const a=topics.get(topicIdFor(n))??[];a.push(n);topics.set(topicIdFor(n),a);}
  for(const a of topics.values()){
    const current=a.find(n=>lineageRoleFor(n)==='current'&&n.lineage?.reasoningSide!=='opposition')??a[0];
    if(current)for(const n of a)if(n!==current)connect(current.id,n.id,false);
  }
  const realEdges=[...realEdgeKeys].map(key=>key.split('\u0000') as [string,string]).sort((x,y)=>x[0].localeCompare(y[0])||x[1].localeCompare(y[1]));
  return{knowledge,relations,adjacency,outgoing,incoming,realEdges};
}
function components(g:Graph){
  const seen=new Set<string>(),result:string[][]=[];
  for(const seed of g.knowledge.map(n=>n.id).sort()){
    if(seen.has(seed))continue;
    const q=[seed],ids:string[]=[];seen.add(seed);
    for(let i=0;i<q.length;i++){
      const id=q[i]!;ids.push(id);
      for(const x of [...(g.adjacency.get(id)??[])].sort())if(!seen.has(x)){seen.add(x);q.push(x);}
    }
    result.push(ids.sort());
  }
  return result;
}
function depths(ids:string[],g:Graph){
  const set=new Set(ids),ind=new Map<string,number>(),d=new Map<string,number>();
  for(const id of ids){const n=[...(g.incoming.get(id)??[])].filter(x=>set.has(x)).length;ind.set(id,n);if(!n)d.set(id,0);}
  const q=ids.filter(x=>ind.get(x)===0).sort();
  for(let i=0;i<q.length;i++){
    const a=q[i]!;
    for(const b of [...(g.outgoing.get(a)??[])].filter(x=>set.has(x)).sort()){
      d.set(b,Math.max(d.get(b)??0,(d.get(a)??0)+1));ind.set(b,ind.get(b)!-1);if(!ind.get(b))q.push(b);
    }
  }
  for(const id of ids)if(!d.has(id))d.set(id,Math.max(0,...d.values())+1);
  return d;
}
function metadata(g:Graph):Component[]{
  const byId=new Map(g.knowledge.map(n=>[n.id,n]));
  return components(g).map(ids=>{
    const d=depths(ids,g),orders=new Map<number,string[]>();
    for(const id of ids){const a=orders.get(d.get(id)!)??[];a.push(id);orders.set(d.get(id)!,a);}
    for(const a of orders.values())a.sort();
    const set=new Set(ids),relations=g.relations.filter(r=>[...r.premises,...r.conclusions].some(x=>set.has(x)));
    return{id:ids[0]!,ids,relations,branching:relations.reduce((s,r)=>s+Math.max(0,r.premises.length+r.conclusions.length-2),0),layers:new Set(ids.map(id=>layerOf(byId.get(id)!))).size,depth:d,orders};
  });
}
const hardness=(a:Component,b:Component)=>b.ids.length-a.ids.length||b.layers-a.layers||b.branching-a.branching||a.id.localeCompare(b.id);
export function nearestDirectionCell(grid:IcosahedralGrid,direction:THREE.Vector3){
  let best=0,bestDot=-Infinity;
  for(let i=0;i<grid.vertices.length;i++){
    const dot=grid.vertices[i]!.clone().normalize().dot(direction);
    if(dot>bestDot||(dot===bestDot&&i<best)){best=i;bestDot=dot;}
  }
  return best;
}
function addressKey(a:SpatialAddress){return `${a.shellID}:${a.cellID}`}
function radialFor(n:LayoutNode,depth:number,c:Component,b:SemanticBoundaries,extra:number){
  const outer=c.ids.filter(id=>layerOf(nodeMap.get(id)!)==='outer').sort((a,z)=>c.depth.get(a)!-c.depth.get(z)!||a.localeCompare(z));
  if(outer.length)return b.bluePurple+(depth-c.depth.get(outer[0]!)!)*LAYOUT_UNIT+extra;
  const inner=c.ids.filter(id=>layerOf(nodeMap.get(id)!)==='inner').sort((a,z)=>c.depth.get(a)!-c.depth.get(z)!||a.localeCompare(z));
  if(inner.length&&c.ids.some(id=>layerOf(nodeMap.get(id)!)==='middle'))return b.cyanBlue+(depth-c.depth.get(inner[0]!)!)*LAYOUT_UNIT+extra;
  return Math.max(LAYOUT_UNIT,(layerOf(n)==='middle'?b.cyanBlue:layerOf(n)==='outer'?b.bluePurple:LAYOUT_UNIT)+depth*LAYOUT_UNIT+extra);
}
let nodeMap=new Map<string,LayoutNode>();
function realEdgesFor(g:Graph,c:Component){const ids=new Set(c.ids);return g.realEdges.filter(([a,b])=>ids.has(a)&&ids.has(b))}
function realKnowledgeLineLength(placed:readonly Placement[],edges:readonly CrossingEdge[]){
  const positions=new Map(placed.map(p=>[p.id,p.position]));
  return edges.reduce((sum,[a,b])=>{const p=positions.get(a),q=positions.get(b);return p&&q?sum+p.distanceTo(q):sum;},0);
}
function graphAwareOrder(c:Component,g:Graph){
  const depthsSorted=[...c.orders].sort(([a],[b])=>a-b),rank=new Map<string,number>(),answer:string[]=[];
  for(const [,ids] of depthsSorted){
    const sorted=[...ids].sort((a,b)=>{
      const neighborRank=(id:string)=>{
        const ranked=[...(g.incoming.get(id)??[]),...(g.outgoing.get(id)??[])].filter(x=>rank.has(x));
        return ranked.reduce((s,x)=>s+rank.get(x)!,0)/Math.max(1,ranked.length);
      };
      return neighborRank(a)-neighborRank(b)||a.localeCompare(b);
    });
    sorted.forEach((id,i)=>rank.set(id,i));answer.push(...sorted);
  }
  return answer;
}
function shellGroups(c:Component,b:SemanticBoundaries,extra:number,grids:Map<string,IcosahedralGrid>,order:readonly string[]):ShellGroup[]{
  const byShell=new Map<string,{radius:number;grid:IcosahedralGrid;ids:string[];depth:number}>();
  for(const id of order){
    const n=nodeMap.get(id)!,depth=c.depth.get(id)!,radius=radialFor(n,depth,c,b,extra),shellID=`shell:${radius.toFixed(6)}`;
    let grid=grids.get(shellID);if(!grid){grid=generateIcosahedralGrid(radius,undefined,shellID);grids.set(shellID,grid);}
    const group=byShell.get(shellID)??{radius,grid,ids:[],depth};group.ids.push(id);group.depth=Math.min(group.depth,depth);byShell.set(shellID,group);
  }
  return [...byShell.entries()].map(([shellID,g])=>({shellID,radius:g.radius,grid:g.grid,ids:g.ids,depth:g.depth})).sort((a,b)=>a.radius-b.radius||a.shellID.localeCompare(b.shellID));
}
function edgeNeighborMap(edges:readonly CrossingEdge[]){
  const result=new Map<string,string[]>();
  for(const [a,b] of edges){const aa=result.get(a)??[];aa.push(b);result.set(a,aa);const bb=result.get(b)??[];bb.push(a);result.set(b,bb);}
  return result;
}
function targetForNode(id:string,radius:number,placed:ReadonlyMap<string,Placement>,neighbors:ReadonlyMap<string,readonly string[]>,fallback:THREE.Vector3){
  const sum=new THREE.Vector3();let count=0;
  for(const neighbor of neighbors.get(id)??[]){const p=placed.get(neighbor)?.position;if(!p||p.lengthSq()<EPSILON)continue;sum.add(p.clone().normalize());count++;}
  if(!count||sum.lengthSq()<EPSILON)return fallback.clone().multiplyScalar(radius);
  return sum.normalize().multiplyScalar(radius);
}
function legalCandidate(position:THREE.Vector3,occupied:ReadonlyMap<string,THREE.Vector3>,placed:ReadonlyMap<string,Placement>){
  for(const p of occupied.values())if(p.distanceTo(position)<LAYOUT_UNIT-EPSILON)return false;
  for(const p of placed.values())if(p.position.distanceTo(position)<LAYOUT_UNIT-EPSILON)return false;
  return true;
}
export function nearbyCandidateCells(grid:IcosahedralGrid,target:THREE.Vector3,count:number){
  const limit=Math.min(count,grid.vertices.length),best:{i:number;d:number}[]=[];
  for(let i=0;i<grid.vertices.length;i++){
    const candidate={i,d:grid.vertices[i]!.distanceToSquared(target)};
    let insert=best.findIndex(value=>candidate.d<value.d||(candidate.d===value.d&&candidate.i<value.i));
    if(insert<0)insert=best.length;
    if(insert<limit)best.splice(insert,0,candidate);
    if(best.length>limit)best.pop();
  }
  return best.map(value=>value.i);
}
function compareCandidatePath(a:CandidatePath,b:CandidatePath){return a.lineLength-b.lineLength||a.guide-b.guide||a.tie.localeCompare(b.tie)}

/**
 * A component direction is only an insertion anchor. After the first shell, every Knowledge node searches a small
 * candidate set around the radial projection of already placed real neighbours. The retained path with the shortest
 * real Knowledge-to-Knowledge line length wins; Reasoning never enters this objective.
 * Optional local footprints only reserve already-solved side-branch cells before
 * the unchanged real-edge scoring runs; they never add score terms of their own.
 */
function solveDirection(
  c:Component,g:Graph,b:SemanticBoundaries,extra:number,occupied:ReadonlyMap<string,THREE.Vector3>,grids:Map<string,IcosahedralGrid>,
  direction:THREE.Vector3,directionLevel:number,directionSlot:number,footprintPlanner?:LayoutFootprintPlanner,
):DirectionSolution|null {
  const order=graphAwareOrder(c,g),groups=shellGroups(c,b,extra,grids,order),edges=realEdgesFor(g,c),neighbors=edgeNeighborMap(edges);
  let paths:CandidatePath[]=[{placed:[],byId:new Map(),lineLength:0,guide:0,tie:''}];
  for(const group of groups){
    const candidateCount=Math.max(PROJECTION_CANDIDATE_COUNT,group.ids.length*2+1);
    for(const id of group.ids){
      const expanded:CandidatePath[]=[];
      for(const path of paths){
        const target=targetForNode(id,group.radius,path.byId,neighbors,direction);
        for(const cellID of nearbyCandidateCells(group.grid,target,candidateCount)){
          const position=group.grid.vertices[cellID]!;
          if(!legalCandidate(position,occupied,path.byId))continue;
          const placement:Placement={id,address:{shellID:group.shellID,cellID},position:position.clone()};
          const byId=new Map(path.byId);byId.set(id,placement);
          const footprint=footprintPlanner?.({anchor:nodeMap.get(id)!,grid:group.grid,cellID,occupied,placed:byId})??[];
          if(footprint===null)continue;
          let footprintLegal=true;
          for(const reserved of footprint){
            if(reserved.id===id||byId.has(reserved.id)||!legalCandidate(reserved.position,occupied,byId)){
              footprintLegal=false;break;
            }
            byId.set(reserved.id,reserved);
          }
          if(!footprintLegal)continue;
          let increment=0;
          for(const neighbor of neighbors.get(id)??[]){const p=path.byId.get(neighbor)?.position;if(p)increment+=p.distanceTo(position);}
          expanded.push({
            placed:[...path.placed,placement,...footprint],
            byId,
            lineLength:path.lineLength+increment,
            guide:path.guide+position.distanceToSquared(target)/(LAYOUT_UNIT*LAYOUT_UNIT),
            tie:`${path.tie}:${group.shellID}:${cellID}`,
          });
        }
      }
      if(!expanded.length)return null;
      expanded.sort(compareCandidatePath);
      paths=expanded.slice(0,CANDIDATE_PATH_WIDTH);
    }
  }
  paths.sort((a,b)=>{
    const actualA=realKnowledgeLineLength(a.placed,edges),actualB=realKnowledgeLineLength(b.placed,edges);
    return actualA-actualB||compareCandidatePath(a,b);
  });
  const best=paths[0]!;
  const length=realKnowledgeLineLength(best.placed,edges);
  const firstId=order[0]!,first=best.byId.get(firstId)!;
  return{
    placed:best.placed,
    initialLength:length,
    length,
    passes:0,
    directionCellID:first.address.cellID,
    directionLevel,
    directionSlot,
  };
}

function reserveDirection(allocator:DirectionAllocator,level:number,slot:number){
  const used=allocator.used.get(level)??new Set<number>();used.add(slot);allocator.used.set(level,used);
}
function activeDirectionLevel(allocator:DirectionAllocator){
  let level=0;
  while((allocator.used.get(level)?.size??0)>=directionLevelDirections(level).length)level++;
  return level;
}
function searchComponent(
  c:Component,g:Graph,b:SemanticBoundaries,extra:number,occupied:ReadonlyMap<string,THREE.Vector3>,grids:Map<string,IcosahedralGrid>,allocator:DirectionAllocator,
  footprintPlanner?:LayoutFootprintPlanner,
):SearchAttempt {
  const level=activeDirectionLevel(allocator),directions=directionLevelDirections(level),used=allocator.used.get(level)??new Set<number>();
  let directionSwitches=0;
  for(let slot=0;slot<directions.length;slot++){
    if(used.has(slot))continue;
    const solution=solveDirection(c,g,b,extra,occupied,grids,directions[slot]!,level,slot,footprintPlanner);
    if(solution)return{solution,directionSwitches,level};
    directionSwitches++;
  }
  return{solution:null,directionSwitches,level};
}

/**
 * A component may expand outward, but it may not unlock a finer direction level. Finer angular resolution is opened
 * only when every slot in the current level is already owned. There is deliberately no maximum direction level.
 */
function placeFreshComponent(
  c:Component,g:Graph,b:SemanticBoundaries,occupied:ReadonlyMap<string,THREE.Vector3>,grids:Map<string,IcosahedralGrid>,allocator:DirectionAllocator,
  footprintPlanner?:LayoutFootprintPlanner,
){
  let expansions=0,directionSwitches=0;
  for(;;){
    const extra=expansions*EXPANSION_UNIT;
    if(!Number.isFinite(extra))throw new Error(`Non-finite outward expansion for component ${c.id}`);
    const searched=searchComponent(c,g,b,extra,occupied,grids,allocator,footprintPlanner);
    directionSwitches+=searched.directionSwitches;
    if(searched.solution){
      reserveDirection(allocator,searched.solution.directionLevel,searched.solution.directionSlot);
      return{solution:searched.solution,expansions,directionSwitches};
    }
    expansions++;
  }
}

function orient(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
function projected(v:THREE.Vector3,axis:THREE.Vector3){
  const up=Math.abs(axis.y)<.9?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0),x=new THREE.Vector3().crossVectors(up,axis).normalize(),y=new THREE.Vector3().crossVectors(axis,x).normalize();
  return new THREE.Vector2(v.dot(x),v.dot(y));
}
export function countLayerCrossings(positions:ReadonlyMap<string,THREE.Vector3>=new Map(),edges:readonly CrossingEdge[]=[]):number {
  if(edges.length<2)return 0;
  const mean=[...positions.values()].reduce((s,p)=>s.add(p.clone().normalize()),new THREE.Vector3());
  if(mean.lengthSq()<EPSILON)mean.set(0,0,1);mean.normalize();
  let count=0;
  for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
    const [a,b]=edges[i]!,[c,d]=edges[j]!;if(a===c||a===d||b===c||b===d)continue;
    const pa=positions.get(a),pb=positions.get(b),pc=positions.get(c),pd=positions.get(d);if(!pa||!pb||!pc||!pd)continue;
    const A=projected(pa,mean),B=projected(pb,mean),C=projected(pc,mean),D=projected(pd,mean);
    if(orient(A,B,C)*orient(A,B,D)<-EPSILON&&orient(C,D,A)*orient(C,D,B)<-EPSILON)count++;
  }
  return count;
}
function placeReasoning(nodes:LayoutNode[],g:Graph){
  const by=new Map(nodes.map(n=>[n.id,n]));
  for(const r of g.relations){
    const n=by.get(r.id);if(!n||!r.premises.length||!r.conclusions.length)continue;
    const mean=(ids:string[])=>ids.reduce((s,id)=>s.add(by.get(id)?.pos??new THREE.Vector3()),new THREE.Vector3()).multiplyScalar(1/ids.length);
    setPosition(n,mean(r.premises).add(mean(r.conclusions)).multiplyScalar(.5));delete n.address;
  }
}
function signature(nodes:readonly LayoutNode[]){return [...nodes].sort((a,b)=>a.id.localeCompare(b.id)).map(n=>`${n.id}:${n.type}:${[...(n.premises??[])].sort()}:${n.effectiveLayer??n.layer??n.declaredLayer}:${n.hidden}:${n.lineage?.topicId}:${n.lineage?.role}:${n.lineage?.reasoningSide}`).join('|')}
function componentSignature(c:Component){
  const nodePart=c.ids.map(id=>{const n=nodeMap.get(id)!;return `${id}:${layerOf(n)}:${[...(n.premises??[])].sort().join(',')}:${n.lineage?.topicId??''}:${n.lineage?.role??''}:${n.lineage?.reasoningSide??''}`;}).join('|');
  const relationPart=c.relations.map(r=>`${r.id}:${r.premises.join(',')}>${r.conclusions.join(',')}`).sort().join('|');
  return `${nodePart}::${relationPart}`;
}
function componentCache(componentsMeta:readonly Component[]){return new Map(componentsMeta.map(c=>[c.id,Object.freeze({signature:componentSignature(c),ids:Object.freeze([...c.ids])})]))}
function blueThickness(b:SemanticBoundaries){return b.bluePurple-b.cyanBlue}
function boundaryDeltas(previous:SemanticBoundaries,next:SemanticBoundaries){return{cyan:next.cyanBlue-previous.cyanBlue,blue:blueThickness(next)-blueThickness(previous)}}
function isWhole5RStep(value:number){if(value<-EPSILON)return false;const steps=value/LAYOUT_UNIT;return Math.abs(steps-Math.round(steps))<=EPSILON}
function boundaryShiftFor(c:Component,cyanDelta:number,blueDelta:number){
  const layers=c.ids.map(id=>layerOf(nodeMap.get(id)!)),pureCyan=layers.every(layer=>layer==='inner'),hasPurple=layers.some(layer=>layer==='outer');
  return(pureCyan?0:cyanDelta)+(hasPurple?blueDelta:0);
}
function gridAt(radius:number,grids:Map<string,IcosahedralGrid>){
  const shellID=`shell:${radius.toFixed(6)}`;let grid=grids.get(shellID);
  if(!grid){grid=generateIcosahedralGrid(radius,undefined,shellID);grids.set(shellID,grid);}
  return grid;
}
/** Boundary expansion is not a new layout: fixed chain directions/rays are mapped first, then the whole chain is inserted atomically. No direction search or chain optimization is allowed here. */
function remapComponentOutward(c:Component,shift:number,grids:Map<string,IcosahedralGrid>):Placement[]{
  if(!cache)throw new Error('Boundary remap requires a committed layout cache');
  const planned:Placement[]=[];
  for(const id of c.ids){
    const oldPosition=cache.positions.get(id),oldAddress=cache.addresses.get(id);
    if(!oldPosition||!oldAddress)throw new Error(`Missing committed placement for component ${c.id}`);
    if(shift<=EPSILON){
      const grid=gridAt(oldPosition.length(),grids);
      planned.push({id,address:oldAddress,position:grid.vertices[oldAddress.cellID]?.clone()??oldPosition.clone()});
      continue;
    }
    const radius=oldPosition.length()+shift,grid=gridAt(radius,grids),ray=oldPosition.clone().normalize(),cellID=nearestDirectionCell(grid,ray);
    planned.push({id,address:{shellID:grid.shellID,cellID},position:grid.vertices[cellID]!.clone()});
  }
  return planned;
}
function placementsAreLegal(planned:readonly Placement[],occupied:ReadonlyMap<string,THREE.Vector3>){
  const keys=new Set<string>();
  for(let i=0;i<planned.length;i++){
    const a=planned[i]!,key=addressKey(a.address);if(keys.has(key))return false;keys.add(key);
    for(const p of occupied.values())if(a.position.distanceTo(p)<LAYOUT_UNIT-EPSILON)return false;
    for(let j=0;j<i;j++)if(a.position.distanceTo(planned[j]!.position)<LAYOUT_UNIT-EPSILON)return false;
  }
  return true;
}
function snapshotSpatialState(nodes:readonly LayoutNode[]){return new Map(nodes.map(n=>[n.id,Object.freeze({address:n.address?{...n.address}:undefined,pos:n.pos?.clone(),homePos:n.homePos?.clone(),vel:n.vel?.clone()})]))}
function restoreSpatialSnapshot(nodes:LayoutNode[],snapshot:ReadonlyMap<string,NodeSpatialSnapshot>){
  for(const n of nodes){
    const old=snapshot.get(n.id);if(!old)continue;
    if(old.address)n.address={...old.address};else delete n.address;
    if(old.pos)n.pos=old.pos.clone();else delete n.pos;
    if(old.homePos)n.homePos=old.homePos.clone();else delete n.homePos;
    if(old.vel)n.vel=old.vel.clone();else delete n.vel;
  }
}
function commitSpatialState(nodes:LayoutNode[],g:Graph,addresses:ReadonlyMap<string,SpatialAddress>,grids:ReadonlyMap<string,IcosahedralGrid>){
  for(const [id,address] of addresses){const n=nodeMap.get(id),grid=grids.get(address.shellID);if(!n)continue;if(!grid)throw new Error(`Missing ISG grid ${address.shellID} during atomic commit`);n.address=address;setPosition(n,grid.vertices[address.cellID]!);}
  for(const n of nodes.filter(n=>isSystemCoreNodeId(n.id))){const i=Math.max(0,SUN_TRIAD_IDS.indexOf(n.id as never)),a=i*Math.PI*2/SUN_TRIAD_IDS.length;setPosition(n,new THREE.Vector3(Math.cos(a)*SUN_ORBIT_RADIUS,Math.sin(a)*SUN_ORBIT_RADIUS,0));delete n.address;}
  placeReasoning(nodes,g);
}

export function applyDeterministic5RLayout<T extends LayoutNode>(nodes:T[],options:DeterministicLayoutOptions={}):T[]{
  const sig=`${signature(nodes)}::footprint:${options.footprintSignature??(options.footprintPlanner?'enabled':'none')}`;
  if(cache?.signature===sig){
    for(const n of nodes){const p=cache.positions.get(n.id),a=cache.addresses.get(n.id);if(p)setPosition(n,p);if(a)n.address=a;}
    lastDiagnostics=cache.diagnostics;return nodes;
  }
  const inputSnapshot=snapshotSpatialState(nodes);
  activeGridCache=new Map();activeFrequencyCache=new Map();activeGridBuildCount=0;
  const g=buildGraph(nodes);nodeMap=new Map(nodes.map(n=>[n.id,n]));
  const boundaries=computeSemanticBoundaries(nodes),complex=metadata(g).sort(hardness),ordered=[...complex.filter(c=>c.ids.length>1),...complex.filter(c=>c.ids.length===1)];
  const occupied=new Map<string,THREE.Vector3>(),grids=new Map<string,IcosahedralGrid>(),addresses=new Map<string,SpatialAddress>(),orders=new Map<string,readonly string[]>(),used=new Map<string,number>();
  const componentExpansionCounts=new Map<string,number>(),componentInitialLineLengths=new Map<string,number>(),componentLineLengths=new Map<string,number>(),componentOptimizationPasses=new Map<string,number>(),directionSwitchCounts=new Map<string,number>();
  const componentDirectionLevels=new Map<string,number>(),componentDirectionSlots=new Map<string,number>(),boundaryRemappedComponents=new Set<string>(),boundaryShiftByComponent=new Map<string,number>();
  const allocator:DirectionAllocator={used:new Map()};
  const macroAssignments=new Map<string,number>();
  let expansionCount=0,placementOrder:Component[]=ordered;
  const acceptFresh=(c:Component)=>{
    const placed=placeFreshComponent(c,g,boundaries,occupied,grids,allocator,options.footprintPlanner),solution=placed.solution;
    componentExpansionCounts.set(c.id,placed.expansions);expansionCount+=placed.expansions;directionSwitchCounts.set(c.id,placed.directionSwitches);
    componentInitialLineLengths.set(c.id,solution.initialLength);componentLineLengths.set(c.id,solution.length);componentOptimizationPasses.set(c.id,solution.passes);
    componentDirectionLevels.set(c.id,solution.directionLevel);componentDirectionSlots.set(c.id,solution.directionSlot);
    if(solution.directionLevel===0)macroAssignments.set(c.id,solution.directionSlot);
    for(const x of solution.placed){occupied.set(addressKey(x.address),x.position);addresses.set(x.id,x.address);}
    orders.set(c.id,graphAwareOrder(c,g));used.set(c.id,solution.directionCellID);
  };
  try{
    const deltas=cache?boundaryDeltas(cache.boundaries,boundaries):null;
    const canRemap=!options.footprintPlanner&&!!cache&&!!deltas&&(deltas.cyan>EPSILON||deltas.blue>EPSILON)&&isWhole5RStep(deltas.cyan)&&isWhole5RStep(deltas.blue);
    if(canRemap){
      const reusable=ordered.filter(c=>cache!.components.get(c.id)?.signature===componentSignature(c)&&c.ids.every(id=>cache!.positions.has(id)&&cache!.addresses.has(id))),reusableIds=new Set(reusable.map(c=>c.id)),fresh=ordered.filter(c=>!reusableIds.has(c.id));
      placementOrder=[...reusable,...fresh];
      for(const c of reusable){
        const level=cache!.diagnostics.componentDirectionLevels.get(c.id),slot=cache!.diagnostics.componentDirectionSlots.get(c.id);
        if(level!==undefined&&slot!==undefined){reserveDirection(allocator,level,slot);componentDirectionLevels.set(c.id,level);componentDirectionSlots.set(c.id,slot);if(level===0)macroAssignments.set(c.id,slot);}
        const shift=boundaryShiftFor(c,deltas!.cyan,deltas!.blue),planned=remapComponentOutward(c,shift,grids);
        if(!placementsAreLegal(planned,occupied))throw new Error(`Outward boundary remap invariant violated for component ${c.id}`);
        for(const x of planned){occupied.set(addressKey(x.address),x.position);addresses.set(x.id,x.address);}
        orders.set(c.id,cache!.diagnostics.componentOrders.get(c.id)??graphAwareOrder(c,g));
        const oldUsed=cache!.diagnostics.usedAngles.get(c.id);if(oldUsed!==undefined)used.set(c.id,oldUsed);
        componentExpansionCounts.set(c.id,cache!.diagnostics.componentExpansionCounts.get(c.id)??0);
        const currentLength=realKnowledgeLineLength(planned,realEdgesFor(g,c));componentInitialLineLengths.set(c.id,currentLength);componentLineLengths.set(c.id,currentLength);
        componentOptimizationPasses.set(c.id,0);directionSwitchCounts.set(c.id,0);boundaryShiftByComponent.set(c.id,shift);if(shift>EPSILON)boundaryRemappedComponents.add(c.id);
      }
      for(const c of fresh)acceptFresh(c);
    }else{
      // Inputs are mutated only after a complete component solution exists. Direction slots are reserved only after the whole component passes global 5R checks.
      for(const c of ordered)acceptFresh(c);
    }
    if(g.knowledge.some(node=>!addresses.has(node.id)))throw new Error('Atomic occupancy rebuild lost Knowledge placements');
    const finalPlacements=[...addresses].map(([id,address])=>{const grid=grids.get(address.shellID);if(!grid)throw new Error(`Missing final grid ${address.shellID}`);return{id,address,position:grid.vertices[address.cellID]!.clone()};});
    if(!placementsAreLegal(finalPlacements,new Map()))throw new Error('Atomic occupancy rebuild violates global 5R spacing');
    // Atomic final commit: no input node is mutated until every remapped/new component and the rebuilt occupancy have passed.
    commitSpatialState(nodes,g,addresses,grids);
    lastDiagnostics=Object.freeze({
      boundaries,occupiedCells:new Set(occupied.keys()),reservedCells:new Set(occupied.keys()),usedAngles:used,componentOrders:orders,
      macroCandidateAngles:directionLevelDirections(0).map((_,i)=>i),macroAssignments,expansionCount,componentExpansionCounts,gridBuildCount:activeGridBuildCount,grids,addresses,
      placementOrder:placementOrder.map(c=>c.id),componentInitialLineLengths,componentLineLengths,componentOptimizationPasses,directionSwitchCounts,
      componentDirectionLevels,componentDirectionSlots,boundaryRemappedComponents,boundaryShiftByComponent,
    });
    cache={signature:sig,boundaries,positions:new Map(nodes.filter(n=>n.pos).map(n=>[n.id,n.pos!.clone()])),addresses:new Map(addresses),diagnostics:lastDiagnostics,components:componentCache(ordered)};
    return nodes;
  }catch(error){restoreSpatialSnapshot(nodes,inputSnapshot);throw error}
  finally{activeGridCache=null;activeFrequencyCache=null;}
}

let lastDiagnostics:LayoutDiagnostics|null=null;
let cache:LayoutCache|null=null;
export function getLastLayoutDiagnostics(){return lastDiagnostics}
export function positionsCollide(a:THREE.Vector3,b:THREE.Vector3){return a.distanceTo(b)<LAYOUT_UNIT-EPSILON}
export function icosahedronMacroDirections(){return directionLevelDirections(0).map(v=>v.clone())}
export function compactTriangularCoordinates(count:number){return Array.from({length:count},(_,i)=>[i,0] as [number,number])}
