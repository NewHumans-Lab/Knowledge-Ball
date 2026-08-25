import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/verify-mobile-browser.mjs';
let source = readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  "    assert.ok(centered.x>=detailBox.x&&centered.x<=detailBox.x+detailBox.width&&centered.y>=detailBox.y&&centered.y<=detailBox.y+detailBox.height,'near-node detail must sit in front of and visually occlude the selected sphere');",
  "    assert.ok(pointAfterDetail.x>=detailBox.x&&pointAfterDetail.x<=detailBox.x+detailBox.width&&pointAfterDetail.y>=detailBox.y&&pointAfterDetail.y<=detailBox.y+detailBox.height,'near-node detail must sit in front of and visually occlude the selected sphere');",
  'detail occlusion assertion',
);
replaceOnce(
  "    // Re-open the focused node and verify all edit variants are entered through one text control.\n    await page.touchscreen.tap(centered.x,centered.y);",
  "    // Re-open the same node at its preserved position and verify all edit variants are entered through one text control.\n    await page.touchscreen.tap(pointAfterDetail.x,pointAfterDetail.y);",
  'direct-detail reopen gesture',
);

writeFileSync(path, source);
console.log('Repaired only the two stale direct-detail centered references');
