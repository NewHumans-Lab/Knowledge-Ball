import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projection = await readFile('src/projection/GraphProjection.ts', 'utf8');
const protocol = await readFile('src/protocol/KnowledgeEditingProtocol.ts', 'utf8');

assert.match(protocol, /export function applyKnowledgeEditInPlace\(/,
  'protocol must expose one validated in-place mutation path for live projection');
assert.match(protocol, /mutateKnowledgeEditInPlace\(next, edit\)/,
  'pure protocol edit must reuse the exact same mutation core after cloning');
assert.match(projection, /applyKnowledgeEditInPlace\(protocolNodes, edit\)/,
  'GraphProjection must use the in-place protocol path');
assert.match(projection, /const existingNodeCount = protocolNodes\.length/,
  'projection must track only the newly appended node delta');
assert.match(projection, /result\.nodes\.slice\(existingNodeCount\)/,
  'projection must materialize only new nodes after the edit');
assert.doesNotMatch(projection, /this\.state\.nodesById\s*=\s*Object\.fromEntries/,
  'non-add edits must never rebuild the authoritative nodesById record');
assert.doesNotMatch(projection, /const masteryById = new Map/,
  'projection must not copy personal state just to survive a graph rebuild');
assert.doesNotMatch(projection, /const lineageById = new Map/,
  'projection must not clone lineage metadata just to survive a graph rebuild');

console.log('Projection knowledge-edit delta architecture checks passed');
