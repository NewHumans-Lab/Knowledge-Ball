import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { KnowledgeStore } from './store.mjs';
import { validKey, validNamespace, validateNodeBatch } from './validation.mjs';

const port = Number(process.env.PORT ?? 8787);
const root = resolve('dist');
const store = new KnowledgeStore(resolve(process.env.KNOWLEDGE_DATA_FILE ?? 'data/knowledge.json'));
function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      const error = new Error('Request body too large');
      error.statusCode = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
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
    const incomingNodes = Array.isArray(body.nodes) ? body.nodes : body.node ? [body.node] : [];
    const existingNodes = validNamespace(namespace) ? await store.list(namespace) : [];
    const validationError = validNamespace(namespace) ? validateNodeBatch(existingNodes, incomingNodes) : 'Invalid namespace';
    if (validationError) {
      send(res, 400, { error: validationError });
      return true;
    }
    await store.saveBatch(namespace, incomingNodes);
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
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname).replace(/^\/Knowledge-Ball\/?/, '/');
    } catch {
      return send(res, 400, { error: 'Invalid URL encoding' });
    }
    if (pathname === '/') pathname = '/index.html';
    const file = resolve(join(root, pathname));
    if (file !== root && !file.startsWith(`${root}${sep}`)) return send(res, 403, { error: 'Forbidden' });
    const content = await readFile(file);
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
      '.apk': 'application/vnd.android.package-archive',
    }[extname(file)] ?? 'application/octet-stream';
    const textual = new Set(['.html', '.js', '.css', '.svg', '.json']).has(extname(file));
    res.writeHead(200, { 'Content-Type': textual ? `${mime}; charset=utf-8` : mime });
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return send(res, 404, { error: 'Not found' });
    if (Number.isInteger(error?.statusCode)) return send(res, error.statusCode, { error: error.message });
    console.error(error);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Knowledge-Ball listening on http://0.0.0.0:${port}`));
