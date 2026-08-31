import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const refreshStart = detail.indexOf('refresh(id = this.currentId): void');
const refreshEnd = detail.indexOf('\n  close(): void', refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart, 'NodeDetailController must expose one refresh lifecycle');
const refresh = detail.slice(refreshStart, refreshEnd);

assert.ok(
  detail.includes('private editMenuOpen = false;'),
  'edit-menu interaction state must be owned by NodeDetailController instead of disposable DOM',
);
assert.ok(
  detail.includes('this.editMenuOpen = !this.editMenuOpen;'),
  'the edit trigger must update controller-owned state before projecting visibility',
);
assert.ok(
  detail.includes('menu.hidden = !this.editMenuOpen;') && detail.includes("editButton.setAttribute('aria-expanded', String(this.editMenuOpen));"),
  'DOM visibility and aria state must be projections of controller-owned edit-menu state',
);
assert.doesNotMatch(
  refresh,
  /querySelector[\s\S]*aria-expanded/,
  'refresh must never recover authoritative interaction state by reading the DOM it is about to replace',
);
assert.ok(
  refresh.includes('this.render(node);'),
  'refresh must rebuild authoritative node content while render preserves controller-owned interaction state',
);
assert.ok(
  detail.includes('aria-expanded="${this.editMenuOpen}"') && detail.includes("${this.editMenuOpen ? '' : ' hidden'}"),
  'fresh DOM created by render must inherit the controller-owned edit-menu state',
);
assert.ok(
  detail.includes('this.editMenuOpen = false;\n    this.setKnowledgeLabelsVisible(false);'),
  'opening a different detail must reset the local edit-menu state',
);
assert.ok(
  detail.includes('this.voteRenderToken++;\n    this.editMenuOpen = false;'),
  'closing detail must clear the local edit-menu state',
);

console.log('Node detail controller-owned refresh state regression tests passed');
