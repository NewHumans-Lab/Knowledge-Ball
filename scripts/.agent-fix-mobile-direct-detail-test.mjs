import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/verify-mobile-browser.mjs';
const source = readFileSync(path, 'utf8');
const matches = source.match(/\bcentered\./g) ?? [];
if (matches.length !== 2) throw new Error(`expected exactly two stale centered references, got ${matches.length}`);
writeFileSync(path, source.replaceAll('centered.', 'pointAfterDetail.'));
console.log('Repaired mobile direct-detail assertions to use the preserved node position');
