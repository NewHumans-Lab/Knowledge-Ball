import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const syncEngine = await readFile('src/sync/SyncEngine.ts', 'utf8');
const supabaseAdapter = await readFile('src/sync/SupabaseSyncAdapter.ts', 'utf8');
const sources = await Promise.all(['src/ui/app.ts', 'vite.config.ts', 'package.json'].map(file => readFile(file, 'utf8')));

assert.match(app, /new SyncEngine\(/, 'web runtime must instantiate SyncEngine');
assert.match(app, /initializeSyncEngine\(\);/, 'web runtime must initialize hosted sync explicitly');
assert.ok(
  app.indexOf('initializeSyncEngine();') < app.indexOf('void bootstrapRemoteFirst('),
  'hosted sync must initialize before the remote-first bootstrap decision',
);
assert.match(app, /hosted: productionSyncAdapter !== null/, 'hosted production must prohibit demo seeding');
assert.match(app, /new FilteredKnowledgePersistence<DomainEvent>/, 'browser persistence must explicitly filter event scope');
assert.match(app, /storageKey: 'knowledge-ball\.personal-events\.v1'/, 'personal events must use a dedicated persistence key');
assert.match(app, /legacyStorageKey: 'knowledge-ball\.events\.v1'/, 'historical mixed cache may only be used as a compatibility source');
assert.match(app, /retain: event => event\.type === 'NodeMasterySet'/, 'only personal mastery may remain browser-persistent in this phase');
assert.match(app, /commitPublicEvent/, 'public UI commands must cross the server-first commit boundary');
assert.doesNotMatch(app, /scheduleBackgroundSync|backgroundSyncTimer/, 'public writes must not rely on deferred local-first upload');

assert.match(syncEngine, /private cursor = '0'/, 'public cursor must be memory-only per page lifetime');
assert.match(syncEngine, /this\.store\.appendValidated\(event\)/, 'server-accepted public events must enter the in-memory store as authoritative events');
assert.doesNotMatch(syncEngine, /SyncMetadataStore|pendingEventIds|acknowledgedEventIds/, 'public sync must not persist local pending/acknowledgement truth');
assert.doesNotMatch(syncEngine, /localStorage/, 'public sync engine must not persist its cursor or queue in browser storage');
assert.match(supabaseAdapter, /public_knowledge_events contains non-public event/, 'public stream paging must fail closed instead of silently skipping an invalid row');

assert.doesNotMatch(app, /saveNode|KnowledgeNodeRecord|KnowledgeRepository/, 'app must not persist node snapshots');
assert.ok(sources.every(source => !source.includes('GitHubKnowledgeGateway')), 'legacy gateway must not be referenced');
assert.ok(sources.every(source => !source.includes('/api/knowledge')), 'legacy API must not be referenced');
await assert.rejects(access('server'), 'production Node server must be deleted');
await assert.rejects(access('src/storage/GitHubKnowledgeGateway.ts'), 'legacy gateway must be deleted');
console.log('Server-authoritative public-data architecture regression tests passed');
