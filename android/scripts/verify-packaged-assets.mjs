import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const webBuild = resolve(root, 'dist');
const packagedBuild = resolve(root, 'android/app/src/main/assets/public');

async function manifest(directory, ignored = new Set()) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(directory);
  const entries = [];
  for (const path of files.sort()) {
    const contents = await readFile(path);
    const name = relative(directory, path);
    if (!ignored.has(name)) entries.push(`${name}\t${contents.length}\t${createHash('sha256').update(contents).digest('hex')}`);
  }
  return entries;
}

const source = await manifest(webBuild);
// Capacitor injects only its runtime bridge beside the copied build. It does not
// replace any application HTML/JS/CSS asset.
const bridgeFiles = new Set(['cordova.js', 'cordova_plugins.js']);
const packaged = await manifest(packagedBuild, bridgeFiles);
if (source.join('\n') !== packaged.join('\n')) {
  console.error('Android packaged assets differ from the current root dist/.');
  console.error(`dist files: ${source.length}; packaged files: ${packaged.length}`);
  process.exit(1);
}

const digest = createHash('sha256').update(source.join('\n')).digest('hex');
console.log(`Android asset parity passed: ${source.length} files, manifest sha256 ${digest}`);
