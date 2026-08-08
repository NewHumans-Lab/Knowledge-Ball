import assert from 'node:assert/strict';
import { GitHubKnowledgeGateway, KnowledgeGatewayError } from './GitHubKnowledgeGateway';

const originalFetch = globalThis.fetch;

async function run(): Promise<void> {
  const gateway = new GitHubKnowledgeGateway({ endpoint: '/api/knowledge', namespace: 'public' });

  globalThis.fetch = async () => new Response('{"error":"Not found"}', {
    status: 404,
    statusText: 'Not Found',
  });
  assert.equal(await gateway.getNode('missing'), null, '404 responses represent a missing node');

  globalThis.fetch = async () => new Response('{"error":"Unavailable"}', {
    status: 503,
    statusText: 'Service Unavailable',
  });
  await assert.rejects(
    () => gateway.getNode('temporarily-unavailable'),
    (error: unknown) => error instanceof KnowledgeGatewayError &&
      error.status === 503 &&
      error.responseBody === '{"error":"Unavailable"}',
    'service failures must not be reported as missing nodes',
  );

  globalThis.fetch = async () => {
    throw new TypeError('network disconnected');
  };
  await assert.rejects(
    () => gateway.getNode('offline'),
    /network disconnected/,
    'network failures must remain visible to the caller',
  );
}

run()
  .then(() => console.log('Knowledge gateway regression tests passed'))
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
