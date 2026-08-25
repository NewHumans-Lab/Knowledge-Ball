import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scene = await readFile('src/ui/scene/KnowledgeScene.ts', 'utf8');
assert.match(scene, /createKnowledgeRelationIndex/, 'scene must consume the generation relation index');
assert.match(scene, /publicNodes === publicNodesSnapshot/, 'scene node array identity must stay stable while graph topology is unchanged');
assert.match(scene, /nodes !== relationIndexNodes/, 'scene must rebuild relation topology only when the graph-generation node array changes');
assert.match(scene, /relationIndexFor\(nodes\)\.relationsFor\(selected\.id\)/, 'selected-neighbour lookup must reuse the scene relation index');
assert.match(scene, /relationIndexFor\(nodes\)\.edges/, 'edge geometry sync must reuse indexed canonical edges');
assert.match(scene, /const forced = selectedRelationIds\(nodes\)/, 'large-mobile LOD must reuse the stable full graph generation for relation lookup');
assert.doesNotMatch(scene, /const forced = selectedRelationIds\(eligible\)/, 'large-mobile LOD must not rebuild relation topology from a new filtered array every frame');
assert.doesNotMatch(scene, /relationIndexFor\(eligible\)/, 'filtered mobile candidates must never become the relation-index generation key');
assert.doesNotMatch(scene, /collectKnowledgeChainEdges/, 'scene runtime must not retain any full topology reconstruction entry point');
assert.doesNotMatch(scene, /buildKnowledgeRelations/, 'scene runtime must not retain any selected-node topology reconstruction entry point');

const app = await readFile('src/ui/app.ts', 'utf8');
assert.match(app, /let knowledgeRelationIndex = createKnowledgeRelationIndex\(\[\]\)/, 'app must own one relation index for its current projection generation');
const syncStart = app.indexOf('function syncNodesFromProjection(): void {');
const syncEnd = app.indexOf('\n}', syncStart);
const syncBlock = app.slice(syncStart, syncEnd + 2);
assert.match(syncBlock, /knowledgeRelationIndex = createKnowledgeRelationIndex\(domainNodes\)/, 'projection-to-view generation change must rebuild the detail relation index exactly at the topology boundary');
assert.match(app, /getRelations: id => knowledgeRelationIndex\.relationsFor\(id\)/, 'node detail must read indexed adjacency instead of rescanning all graph nodes');
assert.doesNotMatch(app, /buildKnowledgeRelations\(id, nodeList\(projection\.state\)\)/, 'node detail refresh must not rebuild canonical topology');

const browserFixture = await readFile('scripts/verify-node-detail-relations-browser.mjs', 'utf8');
assert.doesNotMatch(browserFixture, /debug\.renderNodes\.push\(/, 'browser lineage fixtures must never bypass the projection-to-render generation owner');
assert.match(browserFixture, /debug\.projectionRenderScheduler\.request\(\)/, 'browser lineage fixtures that mutate projection truth must request the production render-generation boundary');
assert.match(browserFixture, /debug\.projectionRenderScheduler\.flushNow\(\)/, 'browser lineage fixture generation must complete deterministically before touch assertions');

console.log('Knowledge relation cache wiring regression tests passed');
