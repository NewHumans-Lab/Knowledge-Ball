import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const appPort = 4174;
const supabasePort = 4180;
const appOrigin = `http://127.0.0.1:${appPort}/Knowledge-Ball/`;
const supabaseOrigin = `http://127.0.0.1:${supabasePort}`;

const seedEvent = {
  id: 'cloud-seed-event',
  type: 'KnowledgeAdded',
  scope: 'public',
  schemaVersion: 1,
  timestamp: 1,
  payload: {
    edit: {
      kind: 'add',
      mode: 'atomic',
      node: { id: 'cloud-seed', title: 'Cloud Seed', type: 'fact', reasoning: 'Authoritative cloud seed' },
    },
    declaredLayers: { 'cloud-seed': 'inner' },
  },
};

const staleLocalEvent = {
  id: 'stale-local-event',
  type: 'KnowledgeAdded',
  scope: 'public',
  schemaVersion: 1,
  timestamp: 1,
  payload: {
    edit: {
      kind: 'add',
      mode: 'atomic',
      node: { id: 'stale-local-node', title: 'STALE LOCAL PUBLIC NODE', type: 'fact', reasoning: 'must never render' },
    },
    declaredLayers: { 'stale-local-node': 'inner' },
  },
};

const events = [seedEvent];
let cloudOnline = true;
let publicPullCount = 0;

function json(response, status = 200) {
  return { status, body: JSON.stringify(response) };
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const mockSupabase = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', supabaseOrigin);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  };
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers);
    response.end();
    return;
  }

  let result;
  try {
    if (url.pathname === '/auth/v1/signup' && request.method === 'POST') {
      result = json({ access_token: `mock-token-${crypto.randomUUID()}`, refresh_token: `mock-refresh-${crypto.randomUUID()}`, expires_in: 3600 });
    } else if (url.pathname === '/auth/v1/token' && request.method === 'POST') {
      result = json({ access_token: `mock-token-${crypto.randomUUID()}`, refresh_token: `mock-refresh-${crypto.randomUUID()}`, expires_in: 3600 });
    } else if (url.pathname === '/rest/v1/public_knowledge_events' && request.method === 'GET') {
      publicPullCount += 1;
      if (!cloudOnline) result = json({ message: 'mock cloud offline' }, 503);
      else {
        const after = Number((url.searchParams.get('sequence') ?? 'gt.0').replace('gt.', ''));
        const limit = Number(url.searchParams.get('limit') ?? 200);
        result = json(events.slice(after, after + limit).map((envelope, index) => ({ sequence: after + index + 1, envelope })));
      }
    } else if (url.pathname === '/rest/v1/rpc/append_public_knowledge_events' && request.method === 'POST') {
      if (!cloudOnline) result = json({ message: 'mock cloud offline' }, 503);
      else {
        const body = await requestBody(request);
        const expectedHead = Number(body.expected_head);
        const batch = Array.isArray(body.event_batch) ? body.event_batch : [];
        if (expectedHead !== events.length) {
          result = json({ code: 'KB409', message: 'head conflict', details: JSON.stringify({ current_head: events.length }) }, 409);
        } else {
          for (const event of batch) {
            if (!events.some(existing => existing.id === event.id)) events.push(event);
          }
          result = json({ head: events.length, acknowledged_event_ids: batch.map(event => event.id) });
        }
      }
    } else if (url.pathname === '/rest/v1/rpc/ensure_anonymous_profile' && request.method === 'POST') {
      result = json(null);
    } else if (url.pathname === '/rest/v1/rpc/get_my_account' && request.method === 'POST') {
      result = json({
        username: null,
        display_name: null,
        avatar_url: null,
        bio: null,
        my_balance: '0.000000',
        total_energy: '0.000000',
        accuracy: 0,
      });
    } else if (url.pathname === '/rest/v1/rpc/settle_expired_pending_knowledge_votes' && request.method === 'POST') {
      result = json(0);
    } else {
      result = json({ message: `unhandled mock route ${request.method} ${url.pathname}` }, 404);
    }
  } catch (error) {
    result = json({ message: error instanceof Error ? error.message : String(error) }, 500);
  }

  response.writeHead(result.status, headers);
  response.end(result.body);
});

await new Promise((resolve, reject) => {
  mockSupabase.once('error', reject);
  mockSupabase.listen(supabasePort, '127.0.0.1', resolve);
});

const appServer = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(appPort)],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: supabaseOrigin,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'mock-publishable-key',
    },
  },
);

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(appOrigin)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite test page did not become reachable');
}

function legacyStorageEnvelope() {
  return JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), events: [staleLocalEvent] });
}

async function preparePage(context) {
  await context.addInitScript(({ legacy }) => {
    localStorage.setItem('knowledge-ball.events.v1', legacy);
  }, { legacy: legacyStorageEnvelope() });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(appOrigin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.syncStatus === 'idle' && Boolean(window.__debug?.projection?.state?.nodesById?.['cloud-seed']));
  return page;
}

async function createThroughRealUi(page, title, description) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true })));
  const overlay = page.locator('#knowledgeCreateOverlay.show');
  await overlay.waitFor({ state: 'visible' });
  assert.equal((await overlay.locator('h3').textContent())?.trim(), '新增知识', 'cloud-authority write must exercise the real standalone create form');
  await overlay.locator('[data-create-title]').fill(title);
  await overlay.locator('[data-create-layer]').selectOption('inner');
  await overlay.locator('[data-create-description]').fill(description);
  await overlay.locator('[data-create-submit]').click();
}

let browser;
try {
  await waitForApp();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] });
  const viewport = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const contextA = await browser.newContext(viewport);
  const contextB = await browser.newContext(viewport);
  try {
    // Both clients are open before the write. B is intentionally never reloaded
    // and the test never invokes B's debug sync method.
    const pageA = await preparePage(contextA);
    const pageB = await preparePage(contextB);

    for (const page of [pageA, pageB]) {
      const state = await page.evaluate(() => ({
        cloud: window.__debug?.projection?.state?.nodesById?.['cloud-seed']?.title ?? null,
        stale: window.__debug?.projection?.state?.nodesById?.['stale-local-node']?.title ?? null,
        legacyStillPresent: localStorage.getItem('knowledge-ball.events.v1')?.includes('STALE LOCAL PUBLIC NODE') ?? false,
        cursor: window.__debug?.syncEngine?.currentCursor?.() ?? null,
      }));
      assert.equal(state.cloud, 'Cloud Seed', 'public graph must hydrate from cloud truth');
      assert.equal(state.stale, null, 'legacy local public knowledge must never enter the projection');
      assert.equal(state.legacyStillPresent, true, 'legacy bytes may remain physically present while being ignored');
      assert.equal(state.cursor, '1', 'fresh hosted page must reach the authoritative seed head');
    }

    const marker = `E2E cloud-only ${crypto.randomUUID()}`;
    const pullsBeforeWrite = publicPullCount;
    await createThroughRealUi(pageA, marker, `Real mobile click probe for ${marker}`);
    await pageA.waitForFunction(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).some(node => node.title === title), marker);
    await pageA.locator('#knowledgeCreateOverlay.show').waitFor({ state: 'hidden' });

    const createdA = await pageA.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).find(node => node.title === title), marker);
    assert.ok(createdA?.id, 'writer must render the server-acknowledged node after the real submit click');
    assert.equal(createdA?.declaredLayer, 'inner', 'real submit must preserve declared layer');
    assert.deepEqual(createdA?.premises ?? [], [], 'standalone cloud write must remain an isolated node with no logical premise edges');
    assert.equal(events.filter(event => event.payload?.edit?.node?.title === marker).length, 1, 'mock cloud must contain exactly one authoritative write');

    await pageB.waitForFunction(
      title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).some(node => node.title === title),
      marker,
      { timeout: 20_000 },
    );
    const createdB = await pageB.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).find(node => node.title === title), marker);
    assert.equal(createdB?.id, createdA.id, 'already-open client must receive the same authoritative node identity automatically');
    assert.equal(createdB?.declaredLayer, 'inner', 'already-open client must receive the same authoritative state automatically');
    assert.deepEqual(createdB?.premises ?? [], [], 'already-open client must receive the same isolated-node structure');
    await pageB.waitForFunction(head => window.__debug?.syncEngine?.currentCursor?.() === String(head), events.length);
    assert.ok(publicPullCount > pullsBeforeWrite, 'automatic convergence must perform cloud pulls after both pages were already open');

    const heads = await Promise.all([pageA, pageB].map(page => page.evaluate(() => ({
      cursor: window.__debug?.syncEngine?.currentCursor?.() ?? null,
      publicNodes: Object.values(window.__debug?.projection?.state?.nodesById ?? {})
        .map(node => ({ id: node.id, title: node.title, status: node.status, hidden: node.hidden ?? false, premises: [...(node.premises ?? [])] }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    }))));
    assert.equal(heads[0].cursor, heads[1].cursor, 'already-open clients must converge to the same cloud cursor');
    assert.deepEqual(heads[0].publicNodes, heads[1].publicNodes, 'already-open clients must project identical public node state');

    // A real UI write while the cloud is unavailable must stay in the new create
    // overlay, surface the server error, and never become a local public fact.
    cloudOnline = false;
    const offlineMarker = `E2E rejected local ${crypto.randomUUID()}`;
    const cloudSizeBeforeOfflineWrite = events.length;
    await createThroughRealUi(pageA, offlineMarker, 'This must never become local public truth');
    await pageA.waitForFunction(() => document.querySelector('#toast')?.textContent?.includes('mock cloud offline'));
    assert.equal(
      await pageA.locator('#knowledgeCreateOverlay').evaluate(element => element.classList.contains('show')),
      true,
      'failed server-first submit must keep the split create overlay open',
    );
    const offlineRendered = await pageA.evaluate(title => Object.values(window.__debug?.projection?.state?.nodesById ?? {}).some(node => node.title === title), offlineMarker);
    assert.equal(offlineRendered, false, 'failed cloud write must never enter the writer projection');
    assert.equal(events.length, cloudSizeBeforeOfflineWrite, 'failed cloud write must never enter authoritative cloud history');

    console.log('Cloud-only real-page click/state test passed');
    console.log(`automatic already-open convergence: ${createdA.id}; cursor ${heads[0].cursor}; stale local ignored; offline local write rejected`);
  } finally {
    await contextA.close();
    await contextB.close();
  }
} finally {
  if (browser) await browser.close();
  appServer.kill('SIGTERM');
  await new Promise(resolve => mockSupabase.close(resolve));
}