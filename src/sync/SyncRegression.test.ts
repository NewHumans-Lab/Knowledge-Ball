import assert from 'node:assert/strict';
import { editNode } from '../command/EditNode';
import { resolveNode } from '../command/ResolveNode';
import { executeKnowledgeEdit } from '../command/KnowledgeEdit';
import { setMastery } from '../command/SetMastery';
import type { DomainEvent, PublicKnowledgeEvent } from '../event/Event';
import { EventStore, type EventPersistence } from '../event/EventStore';
import { GraphProjection } from '../projection/GraphProjection';
import type { GraphState } from '../state/GraphState';
import type { StorageLike } from '../persistence/KnowledgePersistence';
import { RemoteHeadConflictError, type PushResult, type SyncAdapter, type SyncBatch } from './SyncAdapter';
import { SyncEngine } from './SyncEngine';
import { SupabaseSyncAdapter } from './SupabaseSyncAdapter';
import { bootstrapRemoteFirst } from '../bootstrap/RemoteFirstBootstrap';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

class MemoryPersistence implements EventPersistence {
  constructor(private events: DomainEvent[] = []) {}
  loadLocal(): DomainEvent[] { return structuredClone(this.events); }
  saveLocal(events: DomainEvent[]): void { this.events = structuredClone(events); }
}

class RemoteStream implements SyncAdapter {
  events: PublicKnowledgeEvent[] = [];
  online = true;
  pushes: string[][] = [];

  async pull(cursor = '0'): Promise<SyncBatch> {
    if (!this.online) throw new Error('offline');
    return { events: structuredClone(this.events.slice(Number(cursor))), cursor: String(this.events.length) };
  }

  async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    if (!this.online) throw new Error('offline');
    if (Number(expectedCursor) !== this.events.length) throw new RemoteHeadConflictError(String(this.events.length));
    this.pushes.push(events.map(event => event.id));
    for (const event of events) {
      if (!this.events.some(existing => existing.id === event.id)) this.events.push(structuredClone(event));
    }
    return { cursor: String(this.events.length), acknowledgedEventIds: events.map(event => event.id) };
  }
}

function client(
  remote: SyncAdapter | null,
  persistence: EventPersistence = new MemoryPersistence(),
  validate: (event: PublicKnowledgeEvent) => string | null = () => null,
) {
  const projection = new GraphProjection();
  const store = new EventStore<GraphState>(() => structuredClone(projection.state), persistence);
  store.subscribe(event => projection.apply(event));
  const engine = new SyncEngine(store, remote, validate);
  return { store, projection, engine, persistence };
}

async function addAtomic(target: ReturnType<typeof client>, nodeId: string, title: string, reasoning = 'r') {
  await executeKnowledgeEdit(
    target.store,
    target.projection,
    { kind: 'add', mode: 'atomic', node: { id: nodeId, title, type: 'fact', reasoning } },
    event => target.engine.commit(event),
  );
}

const populatedRemote = new RemoteStream();
const populatedWriter = client(populatedRemote);
await addAtomic(populatedWriter, 'remote-existing', 'Remote existing knowledge');
const freshHostedBrowser = client(populatedRemote);
let unexpectedDemoSeeds = 0;
await bootstrapRemoteFirst({
  hosted: true,
  hydrateRemote: () => freshHostedBrowser.engine.sync(),
  hasKnowledge: () => Object.keys(freshHostedBrowser.projection.state.nodesById).length > 0,
  seedDemo: async () => { unexpectedDemoSeeds += 1; },
});
assert.equal(freshHostedBrowser.projection.state.nodesById['remote-existing']?.title, 'Remote existing knowledge', 'fresh browser hydrates authoritative remote knowledge first');
assert.equal(unexpectedDemoSeeds, 0, 'hosted browser must never seed demo knowledge');
assert.equal(populatedRemote.pushes.length, 1, 'fresh browser hydration must never append public events');

const remote = new RemoteStream();
const a = client(remote);
const b = client(remote);
await addAtomic(a, 'shared', 'A created');
assert.equal(remote.events.length, 1, 'public create reaches server before command resolves');
assert.equal(a.projection.state.nodesById.shared?.title, 'A created', 'server-acknowledged create enters memory projection');
await b.engine.sync();
assert.equal(b.projection.state.nodesById.shared?.title, 'A created', 'second client reads server truth');
await editNode(b.store, { nodeId: 'shared', title: 'B edited' }, event => b.engine.commit(event));
assert.equal(b.projection.state.nodesById.shared?.title, 'B edited', 'server-first edit updates writer after acknowledgement');
await a.engine.sync();
assert.equal(a.projection.state.nodesById.shared?.title, 'B edited', 'remote edit propagates to another client');
await resolveNode(a.store, { nodeId: 'shared' }, event => a.engine.commit(event));
await b.engine.sync();
assert.equal(b.projection.state.nodesById.shared?.status, 'verified', 'server-first status event propagates');
assert.ok(remote.events.every(event => !event.type.startsWith('Node')), 'new public writes never use legacy Node* event families');

remote.online = false;
const reasoningBeforeOfflineAttempt = a.projection.state.nodesById.shared?.reasoning;
await assert.rejects(
  editNode(a.store, { nodeId: 'shared', reasoning: 'offline work' }, event => a.engine.commit(event)),
  /offline/,
);
assert.equal(a.projection.state.nodesById.shared?.reasoning, reasoningBeforeOfflineAttempt, 'offline public write must not become local truth');
assert.equal(a.engine.pendingCount(), 0, 'server-authoritative client has no durable public pending queue');
remote.online = true;
await a.engine.sync();

const refreshed = client(remote);
assert.equal(refreshed.projection.state.nodesById.shared, undefined, 'fresh runtime starts without persisted public knowledge');
assert.equal(refreshed.engine.currentCursor(), '0', 'fresh runtime cursor is memory-only and starts at zero');
await refreshed.engine.sync();
assert.equal(refreshed.projection.state.nodesById.shared?.title, 'B edited', 'refresh reconstructs public state from the server');

class ConflictOnceStream extends RemoteStream {
  conflictOnce = true;
  override async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    if (this.conflictOnce) {
      this.conflictOnce = false;
      const winner: PublicKnowledgeEvent = {
        id: 'winner-event',
        type: 'KnowledgeAdded',
        scope: 'public',
        schemaVersion: 1,
        timestamp: 10,
        payload: { edit: { kind: 'add', mode: 'atomic', node: { id: 'winner', title: 'Winner', type: 'fact', reasoning: 'race' } } },
      };
      this.events.push(winner);
      throw new RemoteHeadConflictError(String(this.events.length));
    }
    return super.push(events, expectedCursor);
  }
}
const racingRemote = new ConflictOnceStream();
const racingClient = client(racingRemote);
await assert.rejects(addAtomic(racingClient, 'loser', 'Loser'), RemoteHeadConflictError);
assert.equal(racingClient.projection.state.nodesById.winner?.title, 'Winner', 'conflict recovery pulls the actual remote winner');
assert.equal(racingClient.projection.state.nodesById.loser, undefined, 'conflicted local proposal is never applied as truth');
await addAtomic(racingClient, 'loser', 'Loser');
assert.equal(racingClient.projection.state.nodesById.loser?.title, 'Loser', 'explicit retry can commit against refreshed server state');

const verdictRemote = new RemoteStream();
verdictRemote.events.push(
  {
    id: 'pending-add',
    type: 'KnowledgeAdded',
    scope: 'public',
    schemaVersion: 1,
    timestamp: 20,
    payload: { edit: { kind: 'add', mode: 'atomic', node: { id: 'pending-node', title: 'Pending', type: 'fact', reasoning: 'r' } } },
  },
  {
    id: 'server-verdict',
    type: 'KnowledgeVerdictFinalized',
    scope: 'public',
    schemaVersion: 1,
    timestamp: 21,
    payload: {
      roundId: 'round-1', nodeId: 'pending-node', verdict: 'INCORRECT', closeReason: 'THRESHOLD',
      agreeCount: 0, disagreeCount: 1, requiredVotes: 1, policyVersion: 'ORIGINAL_DESIGN_V2',
    },
  },
);
const verdictClient = client(verdictRemote, new MemoryPersistence(), event =>
  event.type === 'KnowledgeVerdictFinalized' ? 'client-side state validator would reject this authoritative verdict' : null,
);
await verdictClient.engine.sync();
assert.equal(verdictClient.projection.state.nodesById['pending-node']?.status, 'falsified', 'server-authored verdict bypasses state-dependent client rejection');
assert.equal(verdictClient.projection.state.nodesById['pending-node']?.hidden, true, 'authoritative incorrect verdict hides node');
assert.equal(verdictClient.engine.currentCursor(), '2', 'cursor advances only after authoritative verdict is incorporated');

class MalformedBatchStream implements SyncAdapter {
  async pull(): Promise<SyncBatch> {
    return {
      events: [
        {
          id: 'valid-prefix', type: 'KnowledgeAdded', scope: 'public', schemaVersion: 1, timestamp: 30,
          payload: { edit: { kind: 'add', mode: 'atomic', node: { id: 'valid-prefix-node', title: 'Valid', type: 'fact', reasoning: 'r' } } },
        },
        {
          id: 'bad-event', type: 'KnowledgeAdded', scope: 'public', schemaVersion: 99, timestamp: 31,
          payload: { edit: { kind: 'add', mode: 'atomic', node: { id: 'bad', title: 'Bad', type: 'fact', reasoning: 'r' } } },
        } as PublicKnowledgeEvent,
      ],
      cursor: '2',
    };
  }
  async push(): Promise<PushResult> { throw new Error('not used'); }
}
const malformed = client(new MalformedBatchStream());
await assert.rejects(malformed.engine.sync(), /不支持的事件版本/);
assert.equal(malformed.engine.currentCursor(), '0', 'cursor must never advance past an authoritative event that was not incorporated');

class CommitThenLoseResponseStream extends RemoteStream {
  loseOnce = true;
  override async push(events: PublicKnowledgeEvent[], expectedCursor: string): Promise<PushResult> {
    const result = await super.push(events, expectedCursor);
    if (this.loseOnce) {
      this.loseOnce = false;
      throw new Error('response lost after commit');
    }
    return result;
  }
}
const ambiguousRemote = new CommitThenLoseResponseStream();
const ambiguousClient = client(ambiguousRemote);
await addAtomic(ambiguousClient, 'ambiguous', 'Ambiguous acknowledgement');
assert.equal(ambiguousRemote.events.length, 1, 'lost response recovery must not duplicate the committed event');
assert.equal(ambiguousClient.projection.state.nodesById.ambiguous?.title, 'Ambiguous acknowledgement', 'pull-after-error recovers server-committed event');

const privacyRemote = new RemoteStream();
const owner = client(privacyRemote);
await addAtomic(owner, 'private-test', 'Public', 'public');
await setMastery(owner.store, { nodeId: 'private-test', mastery: 'mastered' });
await owner.engine.sync();
assert.ok(privacyRemote.events.every(event => event.scope === 'public'));
assert.ok(!JSON.stringify(privacyRemote.events).includes('mastered'), 'public stream contains no personal mastery payload');

const restoredMastery: DomainEvent = {
  id: 'restored-mastery', type: 'NodeMasterySet', scope: 'personal', schemaVersion: 1, timestamp: 40,
  payload: { nodeId: 'private-test', mastery: 'touched' },
};
const other = client(privacyRemote, new MemoryPersistence([restoredMastery]));
assert.equal(other.projection.state.nodesById['private-test'], undefined, 'personal mastery can restore before remote public graph exists');
await other.engine.sync();
assert.equal(other.projection.state.nodesById['private-test']?.mastery, 'touched', 'remote node hydration reapplies previously restored personal mastery');

const supabaseStorage = new MemoryStorage();
supabaseStorage.setItem('knowledge-ball.supabase-session.v1', JSON.stringify({ access_token: 'test-token', expires_at: 9_999_999_999 }));
const pagedEvents = [0, 1, 2].map(index => ({
  sequence: index + 1,
  envelope: {
    id: `page-${index}`, type: 'NodeCreated', scope: 'public', schemaVersion: 1, timestamp: index + 1,
    payload: { nodeId: `page-${index}`, title: 'page', nodeType: 'fact', reasoning: '', premises: [], source: 'import' },
  } as PublicKnowledgeEvent,
}));
const supabase = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co', publishableKey: 'publishable', pageSize: 2,
  storage: supabaseStorage,
  fetch: (async (input: string | URL | Request) => {
    const after = Number(new URL(String(input)).searchParams.get('sequence')?.replace('gt.', '') ?? 0);
    return new Response(JSON.stringify(pagedEvents.filter(row => row.sequence > after).slice(0, 2)), { status: 200 });
  }) as typeof fetch,
});
const paged = await supabase.pull('0');
assert.deepEqual(paged.events.map(event => event.id), ['page-0', 'page-1', 'page-2'], 'Supabase cursor paging has no gaps');
await assert.rejects(
  supabase.push([{ id: 'private', type: 'NodeMasterySet', scope: 'personal', schemaVersion: 1, timestamp: 1, payload: { nodeId: 'x', mastery: 'mastered' } } as any], '0'),
  /canonical public knowledge events/,
);

const invalidPublicTable = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co', publishableKey: 'publishable', storage: supabaseStorage,
  fetch: (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/rest/v1/public_knowledge_events')) {
      return new Response(JSON.stringify([{
        sequence: 1,
        envelope: { id: 'personal-in-public-table', type: 'NodeMasterySet', scope: 'personal', schemaVersion: 1, timestamp: 1, payload: { nodeId: 'x', mastery: 'touched' } },
      }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch,
});
await assert.rejects(invalidPublicTable.pull('0'), /public_knowledge_events contains non-public event at sequence 1/, 'public paging must fail closed instead of skipping an invalid row and advancing head');

const blockedStorage: StorageLike = {
  getItem() { throw new Error('storage blocked'); },
  setItem() { throw new Error('storage blocked'); },
  removeItem() { throw new Error('storage blocked'); },
};
let anonymousSignupRequests = 0;
const storageResilientSupabase = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'publishable',
  storage: blockedStorage,
  fetch: (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/signup')) {
      anonymousSignupRequests += 1;
      return new Response(JSON.stringify({ access_token: 'ephemeral-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/rest/v1/public_knowledge_events')) return new Response(JSON.stringify([]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch,
});
await storageResilientSupabase.pull('0');
assert.equal(anonymousSignupRequests, 1, 'blocked localStorage must not prevent anonymous Supabase authentication');

const originalGlobalFetch = globalThis.fetch;
let defaultFetchReceiverCorrect = false;
try {
  globalThis.fetch = (async function(this: typeof globalThis, input: string | URL | Request) {
    defaultFetchReceiverCorrect = this === globalThis;
    const url = String(input);
    if (url.endsWith('/auth/v1/signup')) return new Response(JSON.stringify({ access_token: 'bound-token', expires_in: 3600 }), { status: 200 });
    if (url.includes('/rest/v1/public_knowledge_events')) return new Response(JSON.stringify([]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const defaultFetchSupabase = new SupabaseSyncAdapter({
    url: 'https://example.supabase.co',
    publishableKey: 'publishable',
    storage: new MemoryStorage(),
  });
  await defaultFetchSupabase.pull('0');
  assert.equal(defaultFetchReceiverCorrect, true, 'default browser/global fetch must keep its required receiver');
} finally {
  globalThis.fetch = originalGlobalFetch;
}

console.log('Server-authoritative sync and privacy regression tests passed');
