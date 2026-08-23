import { readdir, readFile } from 'node:fs/promises';

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

export async function discoverSchemaVersion(functionName) {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter(name => name.endsWith('.sql'))
    .sort();
  const versions = [];
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapedName}\\s*\\(\\s*\\)[\\s\\S]*?as\\s+\\$\\$\\s*select\\s+'(\\d+)'::text\\s*\\$\\$;`,
    'gi',
  );

  for (const file of files) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
    for (const match of sql.matchAll(pattern)) {
      versions.push({ version: match[1], file });
    }
  }

  if (!versions.length) {
    throw new Error(`No migration declares public.${functionName}()`);
  }
  versions.sort((a, b) => a.version.localeCompare(b.version) || a.file.localeCompare(b.file));
  return versions.at(-1);
}
