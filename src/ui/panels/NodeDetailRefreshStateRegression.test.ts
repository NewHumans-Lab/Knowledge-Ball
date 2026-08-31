import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const openStart = detail.indexOf('open(id: string): void');
const refreshStart = detail.indexOf('refresh(id = this.currentId): void');
const refreshEnd = detail.indexOf('\n  close(): void', refreshStart);
const closeStart = detail.indexOf('close(): void');
const closeEnd = detail.indexOf('\n  destroy(): void', closeStart);
assert.ok(
  openStart >= 0 && refreshStart > openStart && refreshEnd > refreshStart && closeStart >= 0 && closeEnd > closeStart,
  'NodeDetailController must expose open, refresh, and close lifecycles',
);
const open = detail.slice(openStart, refreshStart);
const refresh = detail.slice(refreshStart, refreshEnd);
const close = detail.slice(closeStart, closeEnd);

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
assert.ok(
  detail.includes("editButton?.addEventListener('pointerup'")
    && detail.includes('this.lastEditPointerActivationAt = performance.now();'),
  'real mobile pointer/touch activation must open the edit menu without depending on a synthesized click',
);
assert.ok(
  detail.includes("editButton?.addEventListener('click'")
    && detail.includes('performance.now() - this.lastEditPointerActivationAt < 750'),
  'the click path must dedupe a pointer-generated follow-up activation while preserving non-pointer clicks',
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
  open.includes('this.editMenuOpen = false;')
    && open.includes('this.lastEditPointerActivationAt = Number.NEGATIVE_INFINITY;'),
  'opening a different detail must reset edit-menu and pointer-activation state',
);
assert.ok(
  close.includes('this.editMenuOpen = false;')
    && close.includes('this.lastEditPointerActivationAt = Number.NEGATIVE_INFINITY;'),
  'closing detail must clear edit-menu and pointer-activation state',
);

console.log('Node detail controller-owned refresh and mobile pointer activation regression tests passed');
