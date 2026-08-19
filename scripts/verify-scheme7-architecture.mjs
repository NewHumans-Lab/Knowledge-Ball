import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const authUi = await readFile('src/ui/AuthUi.ts', 'utf8');
const syncEngine = await readFile('src/sync/SyncEngine.ts', 'utf8');
const syncCoordinator = await readFile('src/sync/PublicKnowledgeSyncCoordinator.ts', 'utf8');
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
assert.doesNotMatch(app, /window\.addEventListener\('online',[\s\S]*syncEngine\?\.sync/, 'app must not own a second public reconnect-sync path');

assert.match(syncEngine, /private cursor = '0'/, 'public cursor must be memory-only per page lifetime');
assert.match(syncEngine, /this\.store\.appendValidated\(event\)/, 'server-accepted public events must enter the in-memory store as authoritative events');
assert.doesNotMatch(syncEngine, /SyncMetadataStore|pendingEventIds|metadataStore|private readonly metadata/, 'public sync must not persist local pending/acknowledgement truth');
assert.doesNotMatch(syncEngine, /localStorage|sessionStorage|indexedDB|IndexedDB/, 'public sync engine must not persist its cursor, queue, or public state in browser storage');
assert.match(syncEngine, /result\.acknowledgedEventIds\.includes\(event\.id\)/, 'server acknowledgement may be checked only as the immediate RPC response contract');
assert.match(syncEngine, /PublicKnowledgeSyncCoordinator/, 'SyncEngine must own ongoing public convergence in browser runtime');
assert.match(syncEngine, /公共知识只认云端确认/, 'missing cloud configuration must reject public writes rather than creating local truth');
assert.doesNotMatch(syncEngine, /Promise\.resolve\(this\.store\.append\(event\)\)/, 'cloudless public writes must never fall back to a local append');
assert.match(supabaseAdapter, /public_knowledge_events contains non-public event/, 'public stream paging must fail closed instead of silently skipping an invalid row');

assert.match(syncCoordinator, /DEFAULT_PUBLIC_KNOWLEDGE_SYNC_INTERVAL_MS = 10_000/, 'already-open clients must reconcile automatically on a bounded interval');
assert.match(syncCoordinator, /addEventListener\('online'/, 'public convergence owner must reconcile after reconnect');
assert.match(syncCoordinator, /addEventListener\('knowledge-ball:verdict-finalized'/, 'server verdict signals must request immediate public convergence');
assert.match(syncCoordinator, /addEventListener\('visibilitychange'/, 'foreground resume must request public convergence');
assert.doesNotMatch(syncCoordinator, /localStorage|sessionStorage|indexedDB|IndexedDB/, 'public convergence coordinator must remain storage-free');

assert.doesNotMatch(authUi, /syncEngine/, 'AuthUi must not reach through debug state to drive the public graph');
assert.doesNotMatch(authUi, /requestGraphSync|scheduleRemoteGraphSync|REMOTE_GRAPH_SYNC_MS|graphSyncTimer/, 'account UI must not own public graph polling');
assert.match(authUi, /knowledge-ball:verdict-finalized/, 'AuthUi may publish a server-state-change signal without owning synchronization');

assert.doesNotMatch(app, /saveNode|KnowledgeNodeRecord|KnowledgeRepository/, 'app must not persist node snapshots');
assert.ok(sources.every(source => !source.includes('GitHubKnowledgeGateway')), 'legacy gateway must not be referenced');
assert.ok(sources.every(source => !source.includes('/api/knowledge')), 'legacy API must not be referenced');
await assert.rejects(access('server'), 'production Node server must be deleted');
await assert.rejects(access('src/storage/GitHubKnowledgeGateway.ts'), 'legacy gateway must be deleted');
console.log('Cloud-only server-authoritative public-data architecture regression tests passed');
