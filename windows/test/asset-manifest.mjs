import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function manifest(root) {
  const entries = [];
  async function walk(directory) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, item.name);
      if (item.isDirectory()) await walk(absolute);
      else if (item.isFile()) {
        const bytes = await readFile(absolute);
        entries.push({ path: path.relative(root, absolute).split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
  }
  await walk(root);
  return entries;
}
