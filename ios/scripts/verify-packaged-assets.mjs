import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const webRoot = resolve(root, process.argv[2] ?? 'dist');
const iosRoot = resolve(root, process.argv[3] ?? 'ios/App/App/public');

async function files(directory, current = directory) {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const path = resolve(current, entry.name);
    return entry.isDirectory() ? files(directory, path) : [relative(directory, path)];
  }));
  return nested.flat().sort();
}

async function manifest(directory, paths) {
  return Object.fromEntries(await Promise.all(paths.map(async path => [
    path,
    createHash('sha256').update(await readFile(resolve(directory, path))).digest('hex'),
  ])));
}

const expectedPaths = await files(webRoot);
const packagedPaths = (await files(iosRoot)).filter(path => !['cordova.js', 'cordova_plugins.js'].includes(path));
const expected = await manifest(webRoot, expectedPaths);
const packaged = await manifest(iosRoot, packagedPaths);

if (JSON.stringify(expected) !== JSON.stringify(packaged)) {
  const missing = expectedPaths.filter(path => !(path in packaged));
  const extra = packagedPaths.filter(path => !(path in expected));
  const changed = expectedPaths.filter(path => path in packaged && expected[path] !== packaged[path]);
  throw new Error(`iOS packaged assets differ from dist\nmissing: ${missing.join(', ') || '-'}\nextra: ${extra.join(', ') || '-'}\nchanged: ${changed.join(', ') || '-'}`);
}

console.log(`iOS asset parity verified: ${expectedPaths.length} files match dist by SHA-256`);
