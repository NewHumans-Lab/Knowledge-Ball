from pathlib import Path
import json

app_path = Path('src/ui/app.ts')
app = app_path.read_text()

old = "import { installAccountUi } from './AccountUi';\n"
new = old + "import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';\n"
assert old in app and 'ProjectionRenderScheduler' not in app
app = app.replace(old, new, 1)

marker = "function renderNodeFromDomain(dn: GraphNode): KnowledgeSceneNode {\n"
assert marker in app
mastery_helpers = """function syncPersonalMasteryFromProjection(nodeId: string): void {
  const mastery = projection.state.nodesById[nodeId]?.mastery;
  if (!mastery) return;
  for (const node of layoutNodes) {
    if (node.id === nodeId) {
      node.mastery = mastery;
      break;
    }
  }
  for (const node of renderNodes) {
    if (node.id === nodeId) {
      node.mastery = mastery;
      break;
    }
  }
}

function syncAllPersonalMasteryFromProjection(): void {
  for (const node of layoutNodes) {
    const mastery = projection.state.nodesById[node.id]?.mastery;
    if (mastery) node.mastery = mastery;
  }
  for (const node of renderNodes) {
    const mastery = projection.state.nodesById[node.id]?.mastery;
    if (mastery) node.mastery = mastery;
  }
}

"""
app = app.replace(marker, mastery_helpers + marker, 1)

old_snapshot = """function applyPersonalKnowledgeSnapshot(states: PersonalKnowledgeStateSnapshot[]): void {
  const masteryById = Object.fromEntries(states.map(state => [state.nodeId, state.mastery])) as Record<string, PersonalMastery>;
  projection.replacePersonalMastery(masteryById);
  syncNodesFromProjection();
  scene.markDirty();
}
"""
new_snapshot = """function applyPersonalKnowledgeSnapshot(states: PersonalKnowledgeStateSnapshot[]): void {
  const masteryById = Object.fromEntries(states.map(state => [state.nodeId, state.mastery])) as Record<string, PersonalMastery>;
  projection.replacePersonalMastery(masteryById);
  syncAllPersonalMasteryFromProjection();
  scene.markDirty();
  refreshCurrentKnowledgeSurface();
}
"""
assert old_snapshot in app
app = app.replace(old_snapshot, new_snapshot, 1)

old_subscriber = """store.subscribe((event) => {
  performance.mark?.('knowledge-subscriber-start');
  projection.apply(event);
  // Layer occupancy is global: every event can alter layer membership or visibility,
  // so rebuild the complete slot assignment from the authoritative projection.
  syncNodesFromProjection();
  scene.markDirty();

  if (currentPanelId) {
    const panelOpen = must<HTMLElement>('panel').classList.contains('open');
    if (panelOpen) panel.openNodePanel(currentPanelId);
    else if (nodeDetail?.isOpenFor(currentPanelId)) {
      nodeDetail.refresh(currentPanelId);
      nodeDetailLineageUi?.refresh(currentPanelId);
    }
  }
  performance.mark?.('knowledge-subscriber-end');
  performance.measure?.('knowledge-subscriber', 'knowledge-subscriber-start', 'knowledge-subscriber-end');
});
"""
new_subscriber = """function refreshCurrentKnowledgeSurface(): void {
  if (!currentPanelId) return;
  const panelOpen = must<HTMLElement>('panel').classList.contains('open');
  if (panelOpen) panel.openNodePanel(currentPanelId);
  else if (nodeDetail?.isOpenFor(currentPanelId)) {
    nodeDetail.refresh(currentPanelId);
    nodeDetailLineageUi?.refresh(currentPanelId);
  }
}

function flushProjectionRender(): void {
  performance.mark?.('knowledge-render-flush-start');
  syncNodesFromProjection();
  scene.markDirty();
  refreshCurrentKnowledgeSurface();
  performance.mark?.('knowledge-render-flush-end');
  performance.measure?.('knowledge-render-flush', 'knowledge-render-flush-start', 'knowledge-render-flush-end');
}

const projectionRenderScheduler = new ProjectionRenderScheduler(flushProjectionRender);

store.subscribe((event) => {
  performance.mark?.('knowledge-subscriber-start');
  projection.apply(event);
  if (event.type === 'NodeMasterySet') {
    // Personal mastery changes visibility/style only. They never change graph
    // topology, lineage, layer membership, or spatial constraints.
    syncPersonalMasteryFromProjection(event.payload.nodeId);
    scene.markDirty();
    if (currentPanelId === event.payload.nodeId) refreshCurrentKnowledgeSurface();
  } else {
    // Public/domain truth still advances event-by-event. A synchronous replay
    // burst gets one derived full-graph render/layout at the microtask boundary.
    projectionRenderScheduler.request();
  }
  performance.mark?.('knowledge-subscriber-end');
  performance.measure?.('knowledge-subscriber', 'knowledge-subscriber-start', 'knowledge-subscriber-end');
});
"""
assert old_subscriber in app
app = app.replace(old_subscriber, new_subscriber, 1)

old_bootstrap = """  .then(() => {
    syncNodesFromProjection();
    scene.markDirty();
    scene.start();
  })
"""
new_bootstrap = """  .then(() => {
    // Materialize any pending coalesced replay before scene start without
    // rebuilding the same authoritative graph a second time.
    projectionRenderScheduler.flushNow();
    scene.start();
  })
"""
assert old_bootstrap in app
app = app.replace(old_bootstrap, new_bootstrap, 1)

old_debug = """  accountUi,
  scene,
  createKnowledgeNode,
"""
new_debug = """  accountUi,
  scene,
  projectionRenderScheduler,
  createKnowledgeNode,
"""
assert old_debug in app
app = app.replace(old_debug, new_debug, 1)
app_path.write_text(app)

Path('src/ui/ProjectionRenderScheduler.ts').write_text("""export type ProjectionRenderFlush = () => void;
export type ProjectionRenderSchedule = (flush: () => void) => void;

/**
 * Coalesces a synchronous burst of authoritative graph events into one
 * expensive projection-to-layout/render refresh. GraphProjection itself stays
 * event-by-event; only the derived view waits until the microtask boundary.
 */
export class ProjectionRenderScheduler {
  private scheduled = false;
  private flushes = 0;

  constructor(
    private readonly flush: ProjectionRenderFlush,
    private readonly schedule: ProjectionRenderSchedule = callback => queueMicrotask(callback),
  ) {}

  request(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      if (!this.scheduled) return;
      this.scheduled = false;
      this.flushes += 1;
      this.flush();
    });
  }

  flushNow(): void {
    if (!this.scheduled) return;
    this.scheduled = false;
    this.flushes += 1;
    this.flush();
  }

  isScheduled(): boolean { return this.scheduled; }
  flushCount(): number { return this.flushes; }
}
""")

Path('src/ui/ProjectionRenderScheduler.test.ts').write_text("""import assert from 'node:assert/strict';
import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';

const queued: Array<() => void> = [];
let renders = 0;
const scheduler = new ProjectionRenderScheduler(
  () => { renders += 1; },
  callback => { queued.push(callback); },
);

for (let i = 0; i < 343; i += 1) scheduler.request();
assert.equal(queued.length, 1, '343 synchronous graph events must schedule one derived render');
assert.equal(renders, 0, 'derived render must wait for the scheduling boundary');
assert.equal(scheduler.isScheduled(), true);
queued.shift()!();
assert.equal(renders, 1, 'the burst must flush exactly once');
assert.equal(scheduler.flushCount(), 1);

scheduler.request();
assert.equal(queued.length, 1);
scheduler.flushNow();
assert.equal(renders, 2, 'flushNow must materialize a pending render once');
assert.equal(scheduler.isScheduled(), false);
queued.shift()!();
assert.equal(renders, 2, 'a stale scheduled callback must not double-render after flushNow');

scheduler.request();
queued.shift()!();
assert.equal(renders, 3, 'the scheduler must accept later independent bursts');
assert.equal(scheduler.flushCount(), 3);
console.log('Projection render scheduler regression tests passed');
""")

Path('src/ui/ProjectionRenderWiringRegression.test.ts').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
assert.match(app, /new ProjectionRenderScheduler\(flushProjectionRender\)/,
  'app must own one coalescing boundary for expensive projection rendering');

const subscriberStart = app.indexOf('store.subscribe((event) => {');
assert.ok(subscriberStart >= 0, 'store subscriber must exist');
const subscriberEnd = app.indexOf('\n});', subscriberStart);
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
const snapshotEnd = app.indexOf('\nfunction openNode', snapshotStart);
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
""")

package_path = Path('package.json')
package = json.loads(package_path.read_text())
extra = " && npx esbuild src/ui/ProjectionRenderScheduler.test.ts --bundle --platform=node --format=esm --outfile=.test-dist/projection-render-scheduler.mjs && node .test-dist/projection-render-scheduler.mjs && npx esbuild src/ui/ProjectionRenderWiringRegression.test.ts --bundle --platform=node --format=esm --outfile=.test-dist/projection-render-wiring.mjs && node .test-dist/projection-render-wiring.mjs"
assert 'ProjectionRenderScheduler.test.ts' not in package['scripts']['test:scene']
package['scripts']['test:scene'] += extra
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')

browser_path = Path('scripts/verify-panel-style-path.mjs')
browser = browser_path.read_text()
old_wait = "await page.waitForFunction(() => Boolean(window.__debug?.store && window.__debug?.projection && window.__debug?.scene), null, { timeout: 20_000 });"
new_wait = "await page.waitForFunction(() => Boolean(window.__debug?.store && window.__debug?.projection && window.__debug?.scene && window.__debug?.projectionRenderScheduler), null, { timeout: 20_000 });"
assert old_wait in browser
browser = browser.replace(old_wait, new_wait, 1)

fixture_marker = "  // Public knowledge is no longer restored from browser localStorage."
assert fixture_marker in browser
browser = browser.replace(fixture_marker, "  const graphFlushesBeforeFixture = await page.evaluate(() => {\n    window.__debug.projectionRenderScheduler.flushNow();\n    return window.__debug.projectionRenderScheduler.flushCount();\n  });\n\n" + fixture_marker, 1)

after_inject = "  await page.waitForFunction(() => (window.__debug?.scene?.getActiveNodeCount?.() ?? 0) > 0, null, { timeout: 20_000 });\n"
assert after_inject in browser
browser = browser.replace(after_inject, after_inject + "  const graphFlushesAfterFixture = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());\n  assert.equal(graphFlushesAfterFixture - graphFlushesBeforeFixture, 1, '343 synchronous authoritative events must produce exactly one full graph render/layout flush');\n", 1)

second_tap_marker = "  const secondTapStarted = performance.now();\n"
assert second_tap_marker in browser
browser = browser.replace(second_tap_marker, "  const graphFlushesBeforeDetailTap = await page.evaluate(() => window.__debug.projectionRenderScheduler.flushCount());\n" + second_tap_marker, 1)

state_marker = "      activeCount: window.__debug.scene.getActiveNodeCount(),\n"
assert state_marker in browser
browser = browser.replace(state_marker, state_marker + "      graphFlushes: window.__debug.projectionRenderScheduler.flushCount(),\n", 1)

mastery_assert = "  assert.equal(state.masteryEvents[0]?.payload?.mastery, 'touched', 'viewed node must append touched mastery');\n"
assert mastery_assert in browser
browser = browser.replace(mastery_assert, mastery_assert + "  assert.equal(state.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render/layout flush');\n", 1)
browser_path.write_text(browser)
