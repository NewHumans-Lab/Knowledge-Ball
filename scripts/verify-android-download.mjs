import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const html = await readFile('dist/index.html', 'utf8');
const manifest = JSON.parse(await readFile('dist/downloads/latest.json', 'utf8'));
const sourceManifest = JSON.parse(await readFile('public/downloads/latest.json', 'utf8'));
const releaseUi = await readFile('src/ui/ReleaseDownloads.ts', 'utf8');
const vite = await readFile('vite.config.ts', 'utf8');

assert.equal(manifest.schema, 1, 'built release manifest must use the current schema');
assert.equal(manifest.version, packageJson.version, 'semantic version must come from package.json');
assert.ok(manifest.build && manifest.commit, 'built manifest must expose Web build identity');
assert.equal(manifest.platforms.web.available, true);
assert.equal(manifest.platforms.web.version, packageJson.version);
assert.equal(manifest.platforms.web.build, manifest.build);
assert.equal(manifest.platforms.web.commit, manifest.commit);

assert.equal(manifest.platforms.android.available, false, 'stale Android APK must not be advertised as the current build');
assert.equal(manifest.platforms.android.version, null);
assert.equal(manifest.platforms.android.build, null);
assert.equal(manifest.platforms.android.commit, null);
assert.deepEqual(manifest.platforms.android.urls, {});
assert.equal(manifest.platforms.android.checksum, null);

assert.equal(manifest.platforms.iosWeb.available, true, 'Safari Web App is a real current distribution');
assert.equal(manifest.platforms.iosWeb.distribution, 'web-app');
assert.equal(manifest.platforms.iosWeb.version, packageJson.version);
assert.match(manifest.platforms.iosWeb.urls.install, /\/ios-install\.html$/);
assert.equal(manifest.platforms.ios.available, false, 'native iOS must stay unavailable until real Apple distribution exists');
assert.equal(manifest.platforms.windows.available, false, 'Windows must stay unavailable until a current installer is published');

assert.notEqual(sourceManifest.version, packageJson.version, 'source template must not impersonate a published semantic release');
assert.equal(sourceManifest.platforms.android.available, false);
assert.equal(sourceManifest.platforms.ios.available, false);
assert.equal(sourceManifest.platforms.windows.available, false);

assert.match(html, /id="iosDownloadMeta"/, 'built Downloads UI must use release-controlled iOS metadata');
assert.match(html, /id="androidDownloadMeta"/, 'built Downloads UI must use release-controlled Android metadata');
assert.match(html, /id="windowsDownloadMeta"/, 'built Downloads UI must use release-controlled Windows metadata');
assert.doesNotMatch(html, /href="\.\/downloads\/knowledge-ball-android-v[^\"]+\.apk"/, 'built HTML must not contain a stale static APK link');
assert.doesNotMatch(html, /版本\s+0\.2\.0\s+·\s+Android/, 'built HTML must not ship a hard-coded Android release claim');
assert.match(html, /type="application\/vnd\.android\.package-archive"/);
assert.match(vite, /ReleaseDownloads\.ts/, 'release-controlled download UI must be part of every built shell');
assert.match(releaseUi, /manifest\.platforms\.android/, 'Android download state must come from the release manifest');
assert.match(releaseUi, /manifest\.platforms\.iosWeb/, 'iOS Web App state must be distinct from native iOS state');

const iosInstall = await readFile('public/ios-install.html', 'utf8');
const webManifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
assert.ok(iosInstall.includes('添加到主屏幕') && webManifest.display === 'standalone', 'iOS Web App path must remain a real PWA install path');

console.log('Release download regression tests passed.');
