import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest } from './asset-manifest.mjs';

const windowsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(windowsRoot, '..', 'dist');
const packaged = process.argv[2] ? path.resolve(process.argv[2]) : path.join(windowsRoot, 'release', 'win-unpacked', 'resources', 'web');
const [sourceManifest, packagedManifest] = await Promise.all([manifest(source), manifest(packaged)]);
assert.deepEqual(packagedManifest, sourceManifest, 'packaged resources/web must be a byte-for-byte manifest match for root dist');
console.log(`Windows packaged asset parity passed: ${sourceManifest.length} files (${packaged})`);
