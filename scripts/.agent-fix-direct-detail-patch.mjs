import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/.agent-direct-detail-personal-visibility.mjs';
const source = readFileSync(path, 'utf8');
const before = String.raw`/  const canvasBox=await page\.locator\('#canvasHost'\)\.boundingBox\(\);[\s\S]*?  assert\.equal\(state\.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render\/layout flush'\);\n/`;
const after = String.raw`/  const canvasBox\s*=\s*await page\.locator\('#canvasHost'\)\.boundingBox\(\);[\s\S]*?  assert\.equal\(state\.graphFlushes, graphFlushesBeforeDetailTap, 'viewed-node mastery must not trigger a full graph render\/layout flush'\);\n/`;
if (!source.includes(before)) throw new Error('expected panel-style patch regex was not found');
writeFileSync(path, source.replace(before, after));
console.log('Adjusted one-shot patch for spaced Issue #51 source formatting');
