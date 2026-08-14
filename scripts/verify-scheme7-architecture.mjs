import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const sources = await Promise.all(['src/ui/app.ts', 'vite.config.ts', 'package.json'].map(file => readFile(file, 'utf8')));
assert.match(app, /new SyncEngine\(/, 'web runtime must instantiate SyncEngine');
assert.match(app, /initializeSyncEngine\(\);/, 'web runtime must initialize hosted sync explicitly');
assert.ok(
  app.indexOf('initializeSyncEngine();') < app.indexOf('void bootstrapRemoteFirst('),
  'hosted sync must initialize before the remote-first bootstrap decision',
);
assert.match(app,/hosted: productionSyncAdapter !== null/,'hosted production must prohibit demo seeding');
assert.doesNotMatch(app, /saveNode|KnowledgeNodeRecord|KnowledgeRepository/, 'app must not persist node snapshots');
assert.ok(sources.every(source => !source.includes('GitHubKnowledgeGateway')), 'legacy gateway must not be referenced');
assert.ok(sources.every(source => !source.includes('/api/knowledge')), 'legacy API must not be referenced');
await assert.rejects(access('server'), 'production Node server must be deleted');
await assert.rejects(access('src/storage/GitHubKnowledgeGateway.ts'), 'legacy gateway must be deleted');
console.log('Scheme 7 architecture regression tests passed');
