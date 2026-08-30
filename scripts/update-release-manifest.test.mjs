import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeReleaseArtifact, updateReleaseManifest } from './update-release-manifest.mjs';

const sha = 'a'.repeat(64);
const baseManifest = {
  schema: 1,
  version: 'development',
  build: 'source',
  commit: 'source',
  platforms: {
    web: { available: false, distribution: 'web', version: null, build: null, commit: null, urls: {}, checksum: null },
    android: { available: false, distribution: 'apk', version: null, build: null, commit: null, urls: {}, checksum: null },
    iosWeb: { available: false, distribution: 'web-app', version: null, build: null, commit: null, urls: {}, checksum: null },
    ios: { available: false, distribution: 'testflight', version: null, build: null, commit: null, urls: {}, checksum: null },
    windows: { available: false, distribution: 'installer', version: null, build: null, commit: null, urls: {}, checksum: null },
  },
};

const androidFragment = {
  platform: 'android',
  available: true,
  distribution: 'apk',
  version: '0.2.0',
  build: '301',
  commit: 'android-commit',
  urls: { download: 'https://github.com/Rushow111/Knowledge-Ball/releases/download/v0.2.0/Knowledge-Ball-Android.apk' },
  checksum: `sha256:${sha}`,
};

const windowsFragment = {
  platform: 'windows',
  available: true,
  distribution: 'installer',
  version: '0.2.0',
  build: '302',
  commit: 'windows-commit',
  urls: {
    installer: 'https://github.com/Rushow111/Knowledge-Ball/releases/download/v0.2.0/Knowledge-Ball-Windows-Setup.exe',
    portable: 'https://github.com/Rushow111/Knowledge-Ball/releases/download/v0.2.0/Knowledge-Ball-Windows-Portable.exe',
  },
  checksums: {
    installer: `sha256:${sha}`,
    portable: `sha256:${'b'.repeat(64)}`,
  },
};

assert.deepEqual(normalizeReleaseArtifact('android', androidFragment), {
  available: true,
  distribution: 'apk',
  version: '0.2.0',
  build: '301',
  commit: 'android-commit',
  urls: androidFragment.urls,
  checksum: `sha256:${sha}`,
});

assert.equal(normalizeReleaseArtifact('windows', windowsFragment).checksum, `sha256:${sha}`);
assert.throws(
  () => normalizeReleaseArtifact('android', { ...androidFragment, checksum: 'sha256:not-a-digest' }),
  /SHA-256/,
);
assert.throws(
  () => normalizeReleaseArtifact('windows', {
    ...windowsFragment,
    urls: { ...windowsFragment.urls, installer: 'http://example.com/setup.exe' },
  }),
  /HTTPS|GitHub Releases/,
);

const directory = await mkdtemp(join(tmpdir(), 'knowledge-ball-release-'));
try {
  const manifestPath = join(directory, 'latest.json');
  const androidPath = join(directory, 'android.json');
  const windowsPath = join(directory, 'windows.json');
  await writeFile(manifestPath, `${JSON.stringify(baseManifest, null, 2)}\n`);
  await writeFile(androidPath, `${JSON.stringify(androidFragment, null, 2)}\n`);
  await writeFile(windowsPath, `${JSON.stringify(windowsFragment, null, 2)}\n`);

  await updateReleaseManifest('android', androidPath, manifestPath);
  let manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.platforms.android.available, true);
  assert.equal(manifest.platforms.windows.available, false);

  await updateReleaseManifest('windows', windowsPath, manifestPath);
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.platforms.android.urls.download, androidFragment.urls.download, 'publishing Windows must preserve Android');
  assert.equal(manifest.platforms.windows.urls.installer, windowsFragment.urls.installer, 'Windows installer must become authoritative');
  assert.equal(manifest.platforms.windows.checksum, `sha256:${sha}`, 'public checksum must cover the installer used by the button');
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Native release manifest publication tests passed.');
