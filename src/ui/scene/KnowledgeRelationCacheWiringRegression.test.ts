import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scene = await readFile('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert.match(scene, /createKnowledgeRelationIndex/, 'scene must consume the generation relation index');
assert.match(scene, /publicNodes === publicNodesSnapshot/, 'scene node array identity must stay stable while graph topology is unchanged');
assert.match(scene, /nodes !== relationIndexNodes/, 'scene must rebuild relation topology only when the graph-generation node array changes');
assert.match(scene, /relationIndexFor\(nodes\)\.relationsFor\(selected\.id\)/, 'selected-neighbour lookup must reuse the scene relation index');
assert.match(scene, /relationIndexFor\(nodes\)\.edges/, 'edge geometry sync must reuse indexed canonical edges');
assert.doesNotMatch(scene, /collectKnowledgeChainEdges\(nodes\)/, 'frame-time edge sync must not reconstruct canonical topology');
assert.doesNotMatch(scene, /buildKnowledgeRelations\(selected\.id, nodes\)/, 'selection changes must not rebuild canonical topology');

const app = await readFile('src/ui/app.ts', 'utf8');
assert.match(app, /let knowledgeRelationIndex = createKnowledgeRelationIndex\(\[\]\)/, 'app must own one relation index for its current projection generation');
const syncStart = app.indexOf('function syncNodesFromProjection(): void {');
const syncEnd = app.indexOf('\n}', syncStart);
const syncBlock = app.slice(syncStart, syncEnd + 2);
assert.match(syncBlock, /knowledgeRelationIndex = createKnowledgeRelationIndex\(domainNodes\)/, 'projection-to-view generation change must rebuild the detail relation index exactly at the topology boundary');
assert.match(app, /getRelations: id => knowledgeRelationIndex\.relationsFor\(id\)/, 'node detail must read indexed adjacency instead of rescanning all graph nodes');
assert.doesNotMatch(app, /buildKnowledgeRelations\(id, nodeList\(projection\.state\)\)/, 'node detail refresh must not rebuild canonical topology');

console.log('Knowledge relation cache wiring regression tests passed');
