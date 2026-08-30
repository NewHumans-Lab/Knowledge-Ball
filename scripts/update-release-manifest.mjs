import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MANIFEST_PATH = 'public/downloads/latest.json';
const EXPECTED = {
  android: { distribution: 'apk', requiredUrl: 'download' },
  windows: { distribution: 'installer', requiredUrl: 'installer' },
};

function requireString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
  return value.trim();
}

function validateReleaseUrl(value, label) {
  const url = new URL(requireString(value, label));
  assert.equal(url.protocol, 'https:', `${label} must use HTTPS`);
  assert.equal(url.hostname, 'github.com', `${label} must be hosted by GitHub Releases`);
  assert.match(url.pathname, /\/releases\/download\//, `${label} must point to a GitHub Release asset`);
  return url.toString();
}

function normalizeChecksum(value, label) {
  const checksum = requireString(value, label).toLowerCase();
  assert.match(checksum, /^sha256:[0-9a-f]{64}$/, `${label} must be a SHA-256 digest`);
  return checksum;
}

export function normalizeReleaseArtifact(platform, fragment) {
  const expected = EXPECTED[platform];
  assert.ok(expected, `Unsupported release platform: ${platform}`);
  assert.equal(fragment?.platform, platform, `release fragment must target ${platform}`);
  assert.equal(fragment?.available, true, `${platform} release fragment must be available`);
  assert.equal(fragment?.distribution, expected.distribution, `${platform} distribution must be ${expected.distribution}`);

  const version = requireString(fragment.version, `${platform}.version`);
  const build = requireString(fragment.build, `${platform}.build`);
  const commit = requireString(fragment.commit, `${platform}.commit`);
  const urls = { ...(fragment.urls ?? {}) };

  if (platform === 'android' && !urls.download && fragment.url) urls.download = fragment.url;
  for (const [key, value] of Object.entries(urls)) {
    urls[key] = validateReleaseUrl(value, `${platform}.urls.${key}`);
  }
  assert.ok(urls[expected.requiredUrl], `${platform}.urls.${expected.requiredUrl} is required`);

  const checksumSource = fragment.checksum ?? fragment.checksums?.[expected.requiredUrl];
  const checksum = normalizeChecksum(checksumSource, `${platform}.checksum`);

  return {
    available: true,
    distribution: expected.distribution,
    version,
    build,
    commit,
    urls,
    checksum,
  };
}

export async function updateReleaseManifest(platform, fragmentPath, manifestPath = DEFAULT_MANIFEST_PATH) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const fragment = JSON.parse(await readFile(fragmentPath, 'utf8'));

  assert.equal(manifest?.schema, 1, 'release manifest must use schema 1');
  assert.ok(manifest?.platforms && typeof manifest.platforms === 'object', 'release manifest must contain platforms');

  manifest.platforms[platform] = normalizeReleaseArtifact(platform, fragment);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  const platform = process.argv[2];
  const fragmentPath = process.argv[3];
  const manifestPath = process.argv[4] ?? DEFAULT_MANIFEST_PATH;
  if (!platform || !fragmentPath) {
    console.error('Usage: node scripts/update-release-manifest.mjs <android|windows> <release-fragment.json> [manifest.json]');
    process.exitCode = 2;
  } else {
    await updateReleaseManifest(platform, fragmentPath, manifestPath);
    console.log(`Published ${platform} availability into ${manifestPath}`);
  }
}
