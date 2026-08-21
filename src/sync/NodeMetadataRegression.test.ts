import assert from 'node:assert/strict';
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
let profileRequests = 0;
const adapter = new SupabaseSyncAdapter({
  url: 'https://example.supabase.co',
  publishableKey: 'publishable',
  storage,
  fetch: (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/rest/v1/public_knowledge_events')) {
      return new Response(JSON.stringify([{
        sequence: 1,
        actor_id: 'actor-rushow',
        created_at: '2026-08-21T04:00:00.000Z',
        envelope: atomic,
      }]), { status: 200 });
    }
    if (url.includes('/rest/v1/knowledge_ball_profiles')) {
      profileRequests += 1;
      return new Response(JSON.stringify([{
        user_id: 'actor-rushow',
        username: 'rushow',
        display_name: null,
      }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch,
});

const pulled = await adapter.pull('0');
assert.deepEqual(pulled.events.map(event => event.id), ['event-atomic']);
assert.equal(profileRequests, 1, 'actor profile should be resolved once for contributor display');
assert.deepEqual(adapter.nodeMetadata('node-atomic'), {
  actorId: 'actor-rushow',
  contributor: 'rushow',
  createdAt: '2026-08-21T04:00:00.000Z',
});
assert.equal(adapter.nodeMetadata('missing'), null);

console.log('Public node metadata regression tests passed');
