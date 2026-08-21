import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { StorageLike } from '../persistence/KnowledgePersistence';
import type { PublicKnowledgeEvent } from '../event/Event';
import { createdNodeIdsFromEvent, SupabaseSyncAdapter } from './SupabaseSyncAdapter';

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

const atomic: PublicKnowledgeEvent = {
  id: 'event-atomic',
  type: 'KnowledgeAdded',
  scope: 'public',
  schemaVersion: 1,
  timestamp: 1,
  payload: {
    edit: {
      kind: 'add',
      mode: 'atomic',
      node: { id: 'node-atomic', title: 'Atomic', type: 'fact', reasoning: 'content' },
    },
  },
};
const theory: PublicKnowledgeEvent = {
  id: 'event-theory',
  type: 'KnowledgeAdded',
  scope: 'public',
  schemaVersion: 1,
  timestamp: 2,
  payload: {
    edit: {
      kind: 'add',
      mode: 'theory',
      requiredPremiseIds: ['node-atomic'],
      reasoning: { id: 'reasoning-1', title: 'Deduction', type: 'reasoning', reasoning: 'steps' },
      conclusion: { id: 'conclusion-1', title: 'Conclusion', type: 'theorem', reasoning: 'result' },
    },
  },
};
assert.deepEqual(createdNodeIdsFromEvent(atomic), ['node-atomic']);
assert.deepEqual(createdNodeIdsFromEvent(theory), ['reasoning-1', 'conclusion-1']);

const storage = new MemoryStorage();
storage.setItem('knowledge-ball.supabase-guest-session.v1', JSON.stringify({ access_token: 'test-token', expires_at: 9_999_999_999 }));
let contributorRequests = 0;
let directProfileRequests = 0;
let contributorBody: unknown = null;
const adapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'publishable',
  storage,
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rest/v1/public_knowledge_events')) {
      return new Response(JSON.stringify([{
        sequence: 1,
        actor_id: 'actor-rushow',
        created_at: '2026-08-21T04:00:00.000Z',
        envelope: atomic,
      }]), { status: 200 });
    }
    if (url.includes('/rest/v1/rpc/get_public_contributor_profiles')) {
      contributorRequests += 1;
      contributorBody = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify([{
        actor_id: 'actor-rushow',
        contributor: 'Rushow',
      }]), { status: 200 });
    }
    if (url.includes('/rest/v1/knowledge_ball_profiles')) {
      directProfileRequests += 1;
      return new Response('forbidden', { status: 403 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch,
});

const pulled = await adapter.pull('0');
assert.deepEqual(pulled.events.map(event => event.id), ['event-atomic']);
assert.equal(contributorRequests, 1, 'public contributor RPC should resolve actor presentation once');
assert.equal(directProfileRequests, 0, 'contributor display must not query the protected profile user_id column directly');
assert.deepEqual(contributorBody, { actor_ids: ['actor-rushow'] });
assert.deepEqual(adapter.nodeMetadata('node-atomic'), {
  actorId: 'actor-rushow',
  contributor: 'Rushow',
  createdAt: '2026-08-21T04:00:00.000Z',
});
assert.equal(adapter.nodeMetadata('missing'), null);

const migration = readFileSync('supabase/migrations/202608210001_public_contributor_lookup.sql', 'utf8');
assert.match(migration, /security definer/i, 'contributor lookup must cross the protected profile boundary only through a definer function');
assert.match(migration, /p\.active/, 'inactive profiles must not be exposed as contributor presentation');
assert.match(migration, /public\.public_knowledge_events/, 'only identities already present in the public event stream may be resolved');
assert.match(migration, /grant execute[\s\S]*get_public_contributor_profiles[\s\S]*anon, authenticated/i, 'public readers need only execute on the narrow lookup RPC');
assert.doesNotMatch(migration, /grant\s+select[\s\S]*knowledge_ball_profiles/i, 'contributor fix must not reopen direct profile-table reads');

console.log('Public node metadata regression tests passed');
