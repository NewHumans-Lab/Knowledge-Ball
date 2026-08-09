import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { KnowledgeStore } from './store.mjs';
import { validateNodeBatch } from './validation.mjs';

test('a node saved by one client is visible to another', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-ball-'));
  try {
    const file = join(dir, 'knowledge.json');
    const writer = new KnowledgeStore(file);
    const reader = new KnowledgeStore(file);
    const node = { id: 'shared-1', title: '共享节点' };
    await writer.save('public', node);
    assert.deepEqual(await reader.list('public'), [node]);
    assert.deepEqual(await reader.get('public', node.id), node);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).namespaces.public.nodes[node.id], node);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent validated writes cannot both pass against the same old snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-ball-race-'));
  try {
    const store = new KnowledgeStore(join(dir, 'knowledge.json'));
    const make = id => ({ id, title: 'Same title', type: 'fact', reasoning: `${id} text`, premises: [], status: 'pending', tags: [], domain: 'general', version: 1 });
    const [first, second] = await Promise.all([
      store.validateAndSaveBatch('public', [make('a')], 0, validateNodeBatch),
      store.validateAndSaveBatch('public', [make('b')], 0, validateNodeBatch),
    ]);
    assert.equal([first, second].filter(result => !result.error).length, 1);
    assert.equal([first, second].find(result => result.error)?.error.code, 'REVISION_CONFLICT');
    assert.equal((await store.list('public')).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed write does not permanently poison later writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-ball-'));
  try {
    class RecoveringStore extends KnowledgeStore {
      failures = 1;

      async write(data) {
        if (this.failures-- > 0) throw new Error('temporary disk failure');
        return super.write(data);
      }
    }

    const store = new RecoveringStore(join(dir, 'knowledge.json'));
    await assert.rejects(() => store.save('public', { id: 'first' }), /temporary disk failure/);
    await store.save('public', { id: 'second' });
    assert.deepEqual(await store.list('public'), [{ id: 'second' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
