import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { KnowledgeStore } from './store.mjs';

const port = Number(process.env.PORT ?? 8787);
const root = resolve('dist');
const store = new KnowledgeStore(resolve(process.env.KNOWLEDGE_DATA_FILE ?? 'data/knowledge.json'));
const types = new Set(['axiom', 'definition', 'fact', 'theorem', 'hypothesis', 'prediction', 'opinion', 'value']);

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
  return node && typeof node.id === 'string' && node.id.length <= 100 &&
    typeof node.title === 'string' && Boolean(node.title.trim()) && node.title.length <= 200 &&
    typeof node.reasoning === 'string' && node.reasoning.length <= 10_000 && types.has(node.type) &&
    Array.isArray(node.premises) && node.premises.every(value => typeof value === 'string');
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/knowledge/drafts' && req.method === 'POST') {
    const body = await readJson(req);
    const namespace = body.namespace || 'default';
    if (!/^[\w-]{1,50}$/.test(namespace) || !body.draft || typeof body.draft.title !== 'string') {
      send(res, 400, { error: 'Invalid draft' });
      return true;
    }
    await store.saveDraft(namespace, body.draft);
    send(res, 204);
    return true;
  }
  const prefix = '/api/knowledge/nodes';
  if (!url.pathname.startsWith(prefix)) return false;
  const queryNamespace = url.searchParams.get('namespace') || 'default';
  if (!/^[\w-]{1,50}$/.test(queryNamespace)) {
    send(res, 400, { error: 'Invalid namespace' });
    return true;
  }
  const encodedId = url.pathname.slice(prefix.length).replace(/^\//, '');
  const id = encodedId ? decodeURIComponent(encodedId) : '';
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
    if (!/^[\w-]{1,50}$/.test(namespace) || !validNode(body.node)) {
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
