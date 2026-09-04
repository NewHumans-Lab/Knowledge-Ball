import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const manifestPath = resolve('dist/downloads/latest.json');
const outputPath = resolve('dist/downloads/Knowledge-Ball-Android-latest.apk');
const tempPath = `${outputPath}.tmp`;
const releaseUrlPattern = /^https:\/\/github\.com\/NewHumans-Lab\/Knowledge-Ball\/releases\/download\//;
const checksumPattern = /^sha256:([0-9a-f]{64})$/i;

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        cache: 'no-store',
        headers: { 'user-agent': 'Knowledge-Ball-Pages-Release-Materializer' },
      });
      if (response.ok) return response;
      lastError = new Error(`APK download returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise(resolveDelay => setTimeout(resolveDelay, attempt * 1_500));
  }
  throw lastError;
}

await rm(outputPath, { force: true });
await rm(tempPath, { force: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const android = manifest.platforms?.android;

if (!android?.available) {
  console.log('No published Android APK is available; Pages APK alias was not created.');
  process.exit(0);
}

const releaseUrl = android.urls?.download;
if (typeof releaseUrl !== 'string' || !releaseUrlPattern.test(releaseUrl)) {
  throw new Error('Published Android APK must use the authoritative GitHub Release URL.');
}

const checksumMatch = checksumPattern.exec(android.checksum ?? '');
if (!checksumMatch) throw new Error('Published Android APK must expose a valid sha256 checksum.');
const expectedSha256 = checksumMatch[1].toLowerCase();

const response = await fetchWithRetry(releaseUrl);
const contentType = response.headers.get('content-type') ?? '';
if (!/application\/(?:vnd\.android\.package-archive|octet-stream)/i.test(contentType)) {
  throw new Error(`Published Android URL did not resolve to an APK binary (${contentType || 'no content-type'}).`);
}

const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length === 0) throw new Error('Published Android APK was empty.');
if (bytes.length > 200 * 1024 * 1024) throw new Error('Published Android APK exceeded the 200 MiB Pages safety limit.');

const actualSha256 = createHash('sha256').update(bytes).digest('hex');
if (actualSha256 !== expectedSha256) {
  throw new Error(`Published Android APK checksum mismatch: expected ${expectedSha256}, received ${actualSha256}.`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(tempPath, bytes);
await rename(tempPath, outputPath);
console.log(`Materialized verified Pages APK alias (${bytes.length} bytes, sha256:${actualSha256}).`);
