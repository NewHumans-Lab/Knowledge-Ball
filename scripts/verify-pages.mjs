import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const expectedBase = '/Knowledge-Ball/';
const remoteRoot = process.argv[2];

function pageAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(value => value.startsWith(expectedBase));
}

function validateHtml(html) {
  assert.match(html, /<div class="app" id="app">/, 'Pages HTML must contain the application root');
  assert.doesNotMatch(html, /src="\/src\//, 'Pages HTML must not reference unbuilt source files');
  const assets = pageAssets(html);
  assert.ok(assets.some(asset => /\/assets\/index-[^/]+\.js$/.test(asset)), 'Pages HTML must reference its hashed application bundle');
  return assets;
}

async function verifyLocalBuild() {
  const html = await readFile('dist/index.html', 'utf8');
  const assets = validateHtml(html);
  for (const asset of assets) {
    const relative = asset.slice(expectedBase.length);
    await access(resolve('dist', relative));
  }
  const manifest = JSON.parse(await readFile('dist/downloads/latest.json', 'utf8'));
  assert.equal(manifest.version, '0.1.0');
  await access('dist/downloads/knowledge-ball-android-v0.1.0.apk');
  console.log(`GitHub Pages build regression tests passed (${assets.length} local assets checked)`);
}

async function fetchWithRetry(url, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
      if (response.ok) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 2_000));
  }
  throw lastError;
}

async function verifyLiveSite(root) {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  const pageUrl = new URL(expectedBase.replace(/^\//, ''), new URL('/', normalizedRoot));
  const pageResponse = await fetchWithRetry(pageUrl);
  assert.match(pageResponse.headers.get('content-type') ?? '', /text\/html/i);
  const assets = validateHtml(await pageResponse.text());

  for (const asset of assets) {
    const response = await fetchWithRetry(new URL(asset, pageUrl));
    if (asset.endsWith('.js')) assert.match(response.headers.get('content-type') ?? '', /javascript/i);
    await response.body?.cancel();
  }

  const manifestResponse = await fetchWithRetry(new URL('downloads/latest.json', pageUrl));
  const manifest = await manifestResponse.json();
  assert.equal(manifest.version, '0.1.0');
  const apkResponse = await fetchWithRetry(new URL('downloads/knowledge-ball-android-v0.1.0.apk', pageUrl));
  assert.match(apkResponse.headers.get('content-type') ?? '', /application\/(?:vnd\.android\.package-archive|octet-stream)/i);
  await apkResponse.body?.cancel();
  console.log(`Live GitHub Pages smoke test passed: ${pageUrl}`);
}

if (remoteRoot) await verifyLiveSite(remoteRoot);
else await verifyLocalBuild();
