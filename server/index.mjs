import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { KnowledgeStore } from './store.mjs';

const port = Number(process.env.PORT ?? 8787);
const root = resolve('dist');
const store = new KnowledgeStore(resolve(process.env.KNOWLEDGE_DATA_FILE ?? 'data/knowledge.json'));
const types = new Set(['axiom', 'definition', 'fact', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value']);
const statuses = new Set(['pending', 'verified', 'suspended', 'disputed', 'falsified']);
const masteryLevels = new Set(['none', 'touched', 'mastered']);
const domains = new Set(['logic', 'mathematics', 'physics', 'biology', 'chemistry', 'computer-science', 'economics', 'history', 'philosophy', 'general']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);

function validKey(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !unsafeKeys.has(value);
}

function validNamespace(value) {
  return validKey(value, 50) && /^[\w-]+$/.test(value);
}

function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}

function validNode(node) {
  return node && validKey(node.id, 100) &&
    typeof node.title === 'string' && Boolean(node.title.trim()) && node.title.length <= 200 &&
    typeof node.reasoning === 'string' && node.reasoning.length <= 10_000 && types.has(node.type) &&
    statuses.has(node.status) && masteryLevels.has(node.mastery) && domains.has(node.domain) &&
    Number.isInteger(node.version) && node.version >= 1 &&
    Array.isArray(node.tags) && node.tags.length <= 100 && node.tags.every(value => typeof value === 'string' && value.length <= 100) &&
    Array.isArray(node.premises) && node.premises.length <= 100 && node.premises.every(value => validKey(value, 100));
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/knowledge/drafts' && req.method === 'POST') {
    const body = await readJson(req);
    const namespace = body.namespace || 'default';
    if (!validNamespace(namespace) || !body.draft || typeof body.draft.title !== 'string') {
      send(res, 400, { error: 'Invalid draft' });
      return true;
    }
    await store.saveDraft(namespace, body.draft);
    send(res, 204);
    return true;
  }
  const prefix = '/api/knowledge/nodes';
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false;
  const queryNamespace = url.searchParams.get('namespace') || 'default';
  if (!validNamespace(queryNamespace)) {
    send(res, 400, { error: 'Invalid namespace' });
    return true;
  }
  const encodedId = url.pathname.slice(prefix.length).replace(/^\//, '');
  let id = '';
  try {
    id = encodedId ? decodeURIComponent(encodedId) : '';
  } catch {
    send(res, 400, { error: 'Invalid node id' });
    return true;
  }
  if (id && !validKey(id, 100)) {
    send(res, 400, { error: 'Invalid node id' });
    return true;
  }
  if (req.method === 'GET' && !id) {
    const domain = url.searchParams.get('domain');
    const nodes = await store.list(queryNamespace);
    send(res, 200, domain ? nodes.filter(node => node.domain === domain) : nodes);
    return true;
  }
  if (req.method === 'GET' && id) {
    const node = await store.get(queryNamespace, id);
    send(res, node ? 200 : 404, node ?? { error: 'Not found' });
    return true;
  }
  if (req.method === 'POST' && !id) {
    const body = await readJson(req);
    const namespace = body.namespace || queryNamespace;
    if (!validNamespace(namespace) || !validNode(body.node)) {
      send(res, 400, { error: 'Invalid node' });
      return true;
    }
    await store.save(namespace, body.node);
    send(res, 204);
    return true;
  }
  if (req.method === 'DELETE' && id) {
    await store.delete(queryNamespace, id);
    send(res, 204);
    return true;
  }
  send(res, 405, { error: 'Method not allowed' });
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (await handleApi(req, res, url)) return;
    let pathname = decodeURIComponent(url.pathname).replace(/^\/Knowledge-Ball\/?/, '/');
    if (pathname === '/') pathname = '/index.html';
    const file = resolve(join(root, pathname));
    if (file !== root && !file.startsWith(`${root}${sep}`)) return send(res, 403, { error: 'Forbidden' });
    const content = await readFile(file);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return send(res, 404, { error: 'Not found' });
    console.error(error);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Knowledge-Ball listening on http://0.0.0.0:${port}`));
