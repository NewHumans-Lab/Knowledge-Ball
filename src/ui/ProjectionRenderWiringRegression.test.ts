import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
assert.match(app, /new ProjectionRenderScheduler\(flushProjectionRender\)/,
  'app must own one coalescing boundary for expensive projection rendering');

const subscriberStart = app.indexOf('store.subscribe((event) => {');
assert.ok(subscriberStart >= 0, 'store subscriber must exist');
const subscriberEnd = app.indexOf('
});', subscriberStart);
assert.ok(subscriberEnd > subscriberStart, 'store subscriber must have a finite source block');
const subscriber = app.slice(subscriberStart, subscriberEnd + 4);
assert.match(subscriber, /projection\.apply\(event\)/,
  'GraphProjection must still advance for every authoritative event');
assert.match(subscriber, /event\.type === 'NodeMasterySet'/,
  'personal mastery must have an explicit non-layout path');
assert.match(subscriber, /syncPersonalMasteryFromProjection\(event\.payload\.nodeId\)/,
  'single mastery changes must update only personal scene state');
assert.match(subscriber, /projectionRenderScheduler\.request\(\)/,
  'graph-changing events must request the coalesced render boundary');
assert.doesNotMatch(subscriber, /syncNodesFromProjection\(\)/,
  'store subscriber must never synchronously rebuild the whole graph per event');

const snapshotStart = app.indexOf('function applyPersonalKnowledgeSnapshot');
const snapshotEnd = app.indexOf('
function openNode', snapshotStart);
const snapshot = app.slice(snapshotStart, snapshotEnd);
assert.match(snapshot, /syncAllPersonalMasteryFromProjection\(\)/,
  'account hydration must update mastery without graph layout');
assert.doesNotMatch(snapshot, /syncNodesFromProjection\(\)/,
  'personal account hydration must not rebuild graph geometry');

const bootstrapStart = app.indexOf('void bootstrapRemoteFirst');
const bootstrapEnd = app.indexOf("window.addEventListener('resize'", bootstrapStart);
const bootstrap = app.slice(bootstrapStart, bootstrapEnd);
assert.match(bootstrap, /projectionRenderScheduler\.flushNow\(\)/,
  'bootstrap must materialize a pending replay before scene start');
assert.doesNotMatch(bootstrap, /syncNodesFromProjection\(\)/,
  'bootstrap completion must not duplicate the scheduler-owned full render');
console.log('Projection render wiring regression tests passed');
