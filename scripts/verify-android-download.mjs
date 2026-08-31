import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const html = await readFile('dist/index.html', 'utf8');
const manifest = JSON.parse(await readFile('dist/downloads/latest.json', 'utf8'));
const sourceManifest = JSON.parse(await readFile('public/downloads/latest.json', 'utf8'));
const releaseUi = await readFile('src/ui/ReleaseDownloads.ts', 'utf8');
const vite = await readFile('vite.config.ts', 'utf8');
const androidRelease = await readFile('.github/workflows/android-release.yml', 'utf8');
const windowsRelease = await readFile('.github/workflows/windows-release.yml', 'utf8');

function assertUnavailable(artifact, distribution) {
  assert.equal(artifact.available, false);
  assert.equal(artifact.distribution, distribution);
  assert.equal(artifact.version, null);
  assert.equal(artifact.build, null);
  assert.equal(artifact.commit, null);
  assert.deepEqual(artifact.urls, {});
  assert.equal(artifact.checksum, null);
}

function assertPublished(artifact, distribution, requiredUrl) {
  assert.equal(artifact.available, true);
  assert.equal(artifact.distribution, distribution);
  assert.equal(artifact.version, packageJson.version, 'published native version must match the current semantic version');
  assert.ok(artifact.build && artifact.commit, 'published native artifact must expose build identity');
  assert.match(artifact.urls[requiredUrl], /^https:\/\/github\.com\/NewHumans-Lab\/Knowledge-Ball\/releases\/download\//);
  assert.match(artifact.checksum, /^sha256:[0-9a-f]{64}$/i);
}

function expectedPublished(sourceArtifact, requiredUrl) {
  return sourceArtifact.available === true
    && sourceArtifact.version === packageJson.version
    && Boolean(sourceArtifact.build)
    && Boolean(sourceArtifact.commit)
    && typeof sourceArtifact.urls?.[requiredUrl] === 'string'
    && /^https:\/\/github\.com\/NewHumans-Lab\/Knowledge-Ball\/releases\/download\//.test(sourceArtifact.urls[requiredUrl])
    && /^sha256:[0-9a-f]{64}$/i.test(sourceArtifact.checksum ?? '');
}

assert.equal(manifest.schema, 1, 'built release manifest must use the current schema');
assert.equal(manifest.version, packageJson.version, 'semantic version must come from package.json');
assert.ok(manifest.build && manifest.commit, 'built manifest must expose Web build identity');
assert.equal(manifest.platforms.web.available, true);
assert.equal(manifest.platforms.web.version, packageJson.version);
assert.equal(manifest.platforms.web.build, manifest.build);
assert.equal(manifest.platforms.web.commit, manifest.commit);

if (expectedPublished(sourceManifest.platforms.android, 'download')) {
  assertPublished(manifest.platforms.android, 'apk', 'download');
} else {
  assertUnavailable(manifest.platforms.android, 'apk');
}

assert.equal(manifest.platforms.iosWeb.available, true, 'Safari Web App is a real current distribution');
assert.equal(manifest.platforms.iosWeb.distribution, 'web-app');
assert.equal(manifest.platforms.iosWeb.version, packageJson.version);
assert.match(manifest.platforms.iosWeb.urls.install, /\/ios-install\.html$/);
assert.equal(manifest.platforms.ios.available, false, 'native iOS must stay unavailable until real Apple distribution exists');

if (expectedPublished(sourceManifest.platforms.windows, 'installer')) {
  assertPublished(manifest.platforms.windows, 'installer', 'installer');
} else {
  assertUnavailable(manifest.platforms.windows, 'installer');
}

assert.notEqual(sourceManifest.version, packageJson.version, 'source manifest top-level identity must remain a deployment template');
assert.equal(sourceManifest.platforms.ios.available, false, 'native iOS publication remains outside this release closure');

assert.match(html, /id="iosDownloadMeta"/, 'built Downloads UI must use release-controlled iOS metadata');
assert.match(html, /id="androidDownloadMeta"/, 'built Downloads UI must use release-controlled Android metadata');
assert.match(html, /id="windowsDownloadMeta"/, 'built Downloads UI must use release-controlled Windows metadata');
assert.doesNotMatch(html, /href="\.\/downloads\/knowledge-ball-android-v[^\"]+\.apk"/, 'built HTML must not contain a stale static APK link');
assert.doesNotMatch(html, /版本\s+0\.2\.0\s+·\s+Android/, 'built HTML must not ship a hard-coded Android release claim');
assert.match(html, /type="application\/vnd\.android\.package-archive"/);
assert.match(vite, /publishedNativeArtifact\('android', 'apk', 'download'\)/, 'Pages build must preserve a verified Android release');
assert.match(vite, /publishedNativeArtifact\('windows', 'installer', 'installer'\)/, 'Pages build must preserve a verified Windows release');
assert.match(releaseUi, /manifest\.platforms\.android/, 'Android download state must come from the release manifest');
assert.match(releaseUi, /manifest\.platforms\.iosWeb/, 'iOS Web App state must be distinct from native iOS state');
assert.match(androidRelease, /update-release-manifest\.mjs android/, 'Android release must publish its authoritative manifest state');
assert.match(windowsRelease, /update-release-manifest\.mjs windows/, 'Windows release must publish its authoritative manifest state');
assert.match(androidRelease, /native-release-publication/, 'Android publication must share the cross-platform serialization lock');
assert.match(windowsRelease, /native-release-publication/, 'Windows publication must share the cross-platform serialization lock');

const iosInstall = await readFile('public/ios-install.html', 'utf8');
const webManifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
assert.ok(iosInstall.includes('添加到主屏幕') && webManifest.display === 'standalone', 'iOS Web App path must remain a real PWA install path');

console.log('Release download regression tests passed.');
