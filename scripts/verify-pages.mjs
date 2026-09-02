import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const expectedBase = '/Knowledge-Ball/';
const productName = 'Knowledge Ball';
const remoteRoot = process.argv[2];

function pageAssets(html) {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(value => value.startsWith(expectedBase));
}

function validateHtml(html) {
  assert.match(html, /<div class="app" id="app">/, 'Pages HTML must contain the application root');
  assert.match(html, new RegExp(`<title>${productName}<\\/title>`), 'Browser title must use the canonical product name');
  assert.match(
    html,
    new RegExp(`<meta name="apple-mobile-web-app-title" content="${productName}">`),
    'Apple home-screen title must use the canonical product name',
  );
  assert.doesNotMatch(html, /Knowledge Ball · Living Knowledge Field/, 'promotional tagline must not leak into the product title');
  assert.doesNotMatch(html, /src="\/src\//, 'Pages HTML must not reference unbuilt source files');
  assert.match(html, /<meta\s+name="knowledge-ball-build"\s+content="[^"]+"/, 'Pages HTML must expose its build identity');
  assert.match(
    html,
    /<button class="btn" id="btnPersonal" data-visibility-mode="current"[^>]*data-i18n="app\.current"[^>]*>.*?<\/button>/s,
    'Pages HTML must boot with the canonical Current visibility shell without coupling the regression to one locale',
  );
  assert.doesNotMatch(html, /隐藏\/恢复未接触的知识节点/, 'obsolete binary Personal shell must never ship in a built artifact');
  assert.match(html, /id="openDownloads"/, 'Settings must expose the nested Downloads destination');
  assert.match(html, /id="downloadsOverlay"/, 'Pages HTML must include the Downloads destination');
  assert.match(html, /id="openWhitePaper"/, 'Settings must expose the localized White Paper destination');
  assert.match(html, /class="app-download ios-download-card"/, 'Downloads must include Apple/iOS');
  assert.match(html, /class="app-download android-download-card"/, 'Downloads must include Android');
  assert.match(html, /class="app-download windows-download-card"/, 'Downloads must include Windows');
  assert.match(html, /id="iosDownloadMeta"/, 'iOS release state must be rendered from release metadata');
  assert.match(html, /id="androidDownloadMeta"/, 'Android release state must be rendered from release metadata');
  assert.match(html, /id="windowsDownloadMeta"/, 'Windows release state must be rendered from release metadata');
  assert.match(html, /id="windowsDownload"[^>]*disabled/, 'Windows must boot unavailable until authoritative metadata enables it at runtime');
  assert.doesNotMatch(html, /href="\.\/downloads\/knowledge-ball-android-v[^\"]+\.apk"/, 'Pages HTML must not advertise a stale static APK');
  const assets = pageAssets(html);
  assert.ok(assets.some(asset => /\/assets\/index-[^/]+\.js$/.test(asset)), 'Pages HTML must reference its hashed application bundle');
  return assets;
}

function validatePwaManifest(manifest) {
  assert.equal(manifest.name, productName, 'PWA name must use the canonical product name');
  assert.equal(manifest.short_name, productName, 'PWA short name must use the canonical product name');
}

function validateUnavailableArtifact(artifact, distribution) {
  assert.equal(artifact.available, false);
  assert.equal(artifact.distribution, distribution);
  assert.equal(artifact.version, null);
  assert.equal(artifact.build, null);
  assert.equal(artifact.commit, null);
  assert.deepEqual(artifact.urls, {});
  assert.equal(artifact.checksum, null);
}

function validatePublishedArtifact(artifact, distribution, requiredUrl) {
  assert.equal(artifact.available, true);
  assert.equal(artifact.distribution, distribution);
  assert.equal(artifact.version, packageJson.version, 'native release version must match current package version');
  assert.ok(artifact.build && artifact.commit, 'native release must expose build identity');
  assert.match(artifact.urls[requiredUrl], /^https:\/\/github\.com\/NewHumans-Lab\/Knowledge-Ball\/releases\/download\//);
  assert.match(artifact.checksum, /^sha256:[0-9a-f]{64}$/i);
}

function validateNativeArtifact(artifact, distribution, requiredUrl) {
  if (artifact.available) validatePublishedArtifact(artifact, distribution, requiredUrl);
  else validateUnavailableArtifact(artifact, distribution);
}

function validateReleaseManifest(manifest) {
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.version, packageJson.version, 'release version must derive from package.json');
  assert.ok(manifest.build && manifest.commit, 'release manifest must expose build identity');
  assert.equal(manifest.platforms.web.available, true);
  assert.equal(manifest.platforms.web.version, packageJson.version);
  validateNativeArtifact(manifest.platforms.android, 'apk', 'download');
  assert.equal(manifest.platforms.iosWeb.available, true, 'iOS Web App remains a real current distribution');
  assert.equal(manifest.platforms.iosWeb.version, packageJson.version);
  assert.equal(manifest.platforms.ios.available, false, 'native iOS requires real Apple distribution');
  validateNativeArtifact(manifest.platforms.windows, 'installer', 'installer');
}

async function verifyLocalBuild() {
  const html = await readFile('dist/index.html', 'utf8');
  const assets = validateHtml(html);
  for (const asset of assets) {
    const relative = asset.slice(expectedBase.length);
    await access(resolve('dist', relative));
  }
  validatePwaManifest(JSON.parse(await readFile('dist/manifest.webmanifest', 'utf8')));
  const manifest = JSON.parse(await readFile('dist/downloads/latest.json', 'utf8'));
  validateReleaseManifest(manifest);
  await access(resolve('dist/whitepapers/Knowledge-Ball-White-Paper-ZH.pdf'));
  await access(resolve('dist/whitepapers/Knowledge-Ball-White-Paper-EN.pdf'));
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

async function verifyBinaryRelease(url, label) {
  const response = await fetchWithRetry(url);
  const contentType = response.headers.get('content-type') ?? '';
  assert.match(contentType, /application\/(?:vnd\.android\.package-archive|octet-stream|x-msdownload)/i, `${label} must resolve to a binary download`);
  await response.body?.cancel();
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

  const pwaResponse = await fetchWithRetry(new URL('manifest.webmanifest', pageUrl));
  validatePwaManifest(await pwaResponse.json());

  const manifestResponse = await fetchWithRetry(new URL('downloads/latest.json', pageUrl));
  const manifest = await manifestResponse.json();
  validateReleaseManifest(manifest);

  const iosWebResponse = await fetchWithRetry(manifest.platforms.iosWeb.urls.install);
  assert.match(iosWebResponse.headers.get('content-type') ?? '', /text\/html/i);
  await iosWebResponse.body?.cancel();

  if (manifest.platforms.android.available) {
    await verifyBinaryRelease(manifest.platforms.android.urls.download, 'Android APK');
  } else {
    assert.deepEqual(manifest.platforms.android.urls, {});
  }

  if (manifest.platforms.windows.available) {
    await verifyBinaryRelease(manifest.platforms.windows.urls.installer, 'Windows installer');
  } else {
    assert.deepEqual(manifest.platforms.windows.urls, {});
  }

  console.log(`Live GitHub Pages smoke test passed: ${pageUrl}`);
}

if (remoteRoot) await verifyLiveSite(remoteRoot);
else await verifyLocalBuild();
