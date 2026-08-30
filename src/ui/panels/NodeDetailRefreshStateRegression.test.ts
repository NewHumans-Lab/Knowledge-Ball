import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const refreshStart = detail.indexOf('refresh(id = this.currentId): void');
const refreshEnd = detail.indexOf('\n  close(): void', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'NodeDetailController must expose one refresh lifecycle');
const refresh = detail.slice(refreshStart, refreshEnd);

assert.ok(
  refresh.includes("getAttribute('aria-expanded') === 'true'"),
  'detail refresh must capture whether the edit menu is expanded before rebuilding authoritative content',
);
assert.ok(
  refresh.indexOf("getAttribute('aria-expanded') === 'true'") < refresh.indexOf('this.render(node);'),
  'edit-menu interaction state must be captured before render replaces the DOM',
);
assert.ok(
  refresh.includes('menu.hidden = false;') && refresh.includes("editButton.setAttribute('aria-expanded', 'true');"),
  'detail refresh must restore the expanded edit menu after an async viewed/mastery refresh',
);
assert.ok(
  refresh.indexOf('this.render(node);') < refresh.indexOf('menu.hidden = false;'),
  'menu restoration must happen after authoritative detail content is rendered',
);

console.log('Node detail async-refresh edit-menu state regression tests passed');
