from pathlib import Path

# Add a tiny app-level authority for selected knowledge node + visible knowledge surface.
Path('src/ui/KnowledgeSurfaceState.ts').write_text('''export type KnowledgeSurfaceKind = 'none' | 'detail' | 'panel';

export interface KnowledgeSurfaceSnapshot {
  nodeId: string | null;
  surface: KnowledgeSurfaceKind;
}

/**
 * Authoritative app navigation state for knowledge-node surfaces. Controllers may
 * keep private render caches, but app decisions must never be inferred back from
 * DOM classes or controller-local selected ids.
 */
export class KnowledgeSurfaceState {
  private value: KnowledgeSurfaceSnapshot = { nodeId: null, surface: 'none' };

  get nodeId(): string | null {
    return this.value.nodeId;
  }

  get surface(): KnowledgeSurfaceKind {
    return this.value.surface;
  }

  snapshot(): Readonly<KnowledgeSurfaceSnapshot> {
    return this.value;
  }

  open(surface: Exclude<KnowledgeSurfaceKind, 'none'>, nodeId: string): void {
    this.value = { nodeId, surface };
  }

  close(surface: Exclude<KnowledgeSurfaceKind, 'none'>): void {
    if (this.value.surface === surface) this.clear();
  }

  clear(): void {
    this.value = { nodeId: null, surface: 'none' };
  }
}
''')

# Panel reports its semantic node surface lifecycle explicitly.
p = Path('src/ui/panels/PanelController.ts')
s = p.read_text()
s = s.replace('  onOverlayVisibilityChange?: (visible: boolean) => void;\n', '  onOverlayVisibilityChange?: (visible: boolean) => void;\n  onNodePanelChange?: (id: string | null) => void;\n', 1)
s = s.replace('  private readonly onOverlayVisibilityChange?: (visible: boolean) => void;\n', '  private readonly onOverlayVisibilityChange?: (visible: boolean) => void;\n  private readonly onNodePanelChange?: (id: string | null) => void;\n', 1)
s = s.replace('    this.onOverlayVisibilityChange = options.onOverlayVisibilityChange;\n', '    this.onOverlayVisibilityChange = options.onOverlayVisibilityChange;\n    this.onNodePanelChange = options.onNodePanelChange;\n', 1)
s = s.replace("    this.panel.classList.add('open');\n    this.panelTitle.textContent = node.title;\n", "    this.panel.classList.add('open');\n    this.onNodePanelChange?.(id);\n    this.panelTitle.textContent = node.title;\n", 1)
old = '''  closeNodePanel(): void {
    this.panel.classList.remove('open');
    this.onOverlayVisibilityChange?.(false);
    this.selectedId = null;
    this.panelView = 'detail';
    this.updatePanelExitLabel();
  }
'''
new = '''  closeNodePanel(): void {
    const wasOpen = this.selectedId !== null || this.panel.classList.contains('open');
    this.panel.classList.remove('open');
    this.onOverlayVisibilityChange?.(false);
    this.selectedId = null;
    this.panelView = 'detail';
    this.updatePanelExitLabel();
    if (wasOpen) this.onNodePanelChange?.(null);
  }
'''
if s.count(old) != 1:
    raise SystemExit('Panel close block mismatch')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('src/ui/app.ts')
s = p.read_text()
s = s.replace("import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';\n", "import { ProjectionRenderScheduler } from './ProjectionRenderScheduler';\nimport { KnowledgeSurfaceState } from './KnowledgeSurfaceState';\n", 1)
s = s.replace('let currentPanelId: string | null = null;\n', 'const knowledgeSurfaceState = new KnowledgeSurfaceState();\n', 1)

# Detail actions: create overlays keep the detail context; editing transfers ownership to panel.
s = s.replace('''function launchPanelAction(id: string, action: NodeDetailAction): void {
  currentPanelId = id;
  if (action === 'derive') {
''', '''function launchPanelAction(id: string, action: NodeDetailAction): void {
  if (action === 'derive') {
''', 1)
s = s.replace("  if (!panel.openNodeAction(id, action)) {\n", "  nodeDetail?.close();\n  if (!panel.openNodeAction(id, action)) {\n", 1)

# Personal snapshot refresh is routed through the state owner.
s = s.replace('''  currentPanelId = id;
  if (nodeDetail) {
    panel.closeNodePanel();
    nodeDetail.open(id);
''', '''  if (nodeDetail) {
    panel.closeNodePanel();
    knowledgeSurfaceState.open('detail', id);
    nodeDetail.open(id);
''', 1)

# Successful creation used to clear the logical selection while leaving the DOM
# surface behind. Make that semantic reset explicit and visually coherent.
s = s.replace('''function updateSceneOverlayState(visible: boolean): void {
  scene.setOverlayVisible(visible);
}
''', '''function updateSceneOverlayState(visible: boolean): void {
  scene.setOverlayVisible(visible);
}

function closeKnowledgeSurface(): void {
  const { surface } = knowledgeSurfaceState.snapshot();
  if (surface === 'detail') nodeDetail?.close();
  else if (surface === 'panel') panel.closeNodePanel();
  knowledgeSurfaceState.clear();
}
''', 1)

# All legacy logical-reset assignments become an explicit coherent surface reset
# for create paths, while edit subviews rely on their own final close callback.
s = s.replace('  currentPanelId = null;\n  await applyKnowledgeEdit(edit, declaredLayers);', '  await applyKnowledgeEdit(edit, declaredLayers);\n  closeKnowledgeSurface();', 1)
s = s.replace('  currentPanelId = null;\n  await applyKnowledgeEdit(edit, { [nodeId]: payload.layer });', '  await applyKnowledgeEdit(edit, { [nodeId]: payload.layer });\n  closeKnowledgeSurface();', 1)
s = s.replace('  currentPanelId = null;\n  // Reasoning is structurally', '  // Reasoning is structurally', 1)
s = s.replace("  await applyKnowledgeEdit(edit, { [reasoningId]: 'middle' });\n", "  await applyKnowledgeEdit(edit, { [reasoningId]: 'middle' });\n  closeKnowledgeSurface();\n", 1)
# For edit operations PanelController closes the panel after successful callbacks;
# its explicit lifecycle callback now clears the state, so remove duplicate app flags.
s = s.replace('  currentPanelId = null;\n', '', 5)

# Scene background lifecycle.
old = '''    onBackgroundTap: () => {
      currentPanelId = null;
      nodeDetail?.close();
      panel.closeNodePanel();
    },
    onBackgroundDoubleTap: () => {
      const premiseId = currentPanelId;
      nodeDetail?.close();
      currentPanelId = premiseId;
      if (premiseId) knowledgeCreate.openReasoning(premiseId);
      else knowledgeCreate.openStandalone();
    },
'''
new = '''    onBackgroundTap: () => {
      closeKnowledgeSurface();
    },
    onBackgroundDoubleTap: () => {
      const premiseId = knowledgeSurfaceState.nodeId;
      closeKnowledgeSurface();
      if (premiseId) knowledgeCreate.openReasoning(premiseId);
      else knowledgeCreate.openStandalone();
    },
'''
if s.count(old) != 1:
    raise SystemExit('scene background state block mismatch')
s = s.replace(old, new, 1)

# Panel lifecycle is explicit state input.
s = s.replace('    onOverlayVisibilityChange: updateSceneOverlayState,\n', "    onOverlayVisibilityChange: updateSceneOverlayState,\n    onNodePanelChange: id => id ? knowledgeSurfaceState.open('panel', id) : knowledgeSurfaceState.close('panel'),\n", 1)

# NodeDetail close can clear only the detail surface; it cannot accidentally clear
# a panel state that was opened after it.
s = s.replace('''    onClose: () => {
      currentPanelId = null;
    },
''', "    onClose: () => { knowledgeSurfaceState.close('detail'); },\n", 1)

s = s.replace('onOpenCreateNode: () => currentPanelId ? knowledgeCreate.openReasoning(currentPanelId) : knowledgeCreate.openStandalone(),', "onOpenCreateNode: () => knowledgeSurfaceState.nodeId ? knowledgeCreate.openReasoning(knowledgeSurfaceState.nodeId) : knowledgeCreate.openStandalone(),", 1)

old = '''function refreshCurrentKnowledgeSurface(): void {
  if (!currentPanelId) return;
  const panelOpen = must<HTMLElement>('panel').classList.contains('open');
  if (panelOpen) panel.openNodePanel(currentPanelId);
  else if (nodeDetail?.isOpenFor(currentPanelId)) {
    nodeDetail.refresh(currentPanelId);
  }
}
'''
new = '''function refreshCurrentKnowledgeSurface(): void {
  const { nodeId, surface } = knowledgeSurfaceState.snapshot();
  if (!nodeId) return;
  if (surface === 'panel') panel.openNodePanel(nodeId);
  else if (surface === 'detail') nodeDetail?.refresh(nodeId);
}
'''
if s.count(old) != 1:
    raise SystemExit('refresh surface inference block mismatch')
s = s.replace(old, new, 1)
s = s.replace('if (currentPanelId === event.payload.nodeId) refreshCurrentKnowledgeSurface();', 'if (knowledgeSurfaceState.nodeId === event.payload.nodeId) refreshCurrentKnowledgeSurface();', 1)
# Plus button lower in file.
s = s.replace('currentPanelId ? knowledgeCreate.openReasoning(currentPanelId) : knowledgeCreate.openStandalone()', 'knowledgeSurfaceState.nodeId ? knowledgeCreate.openReasoning(knowledgeSurfaceState.nodeId) : knowledgeCreate.openStandalone()')
# Expose the authority in debug rather than a hidden global flag.
s = s.replace('  projectionRenderScheduler,\n', '  projectionRenderScheduler,\n  knowledgeSurfaceState,\n', 1)
if 'currentPanelId' in s:
    raise SystemExit('currentPanelId remains after LQ-09 patch')
p.write_text(s)

Path('scripts/verify-knowledge-surface-state.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const state = await readFile('src/ui/KnowledgeSurfaceState.ts', 'utf8');

assert.match(state, /class KnowledgeSurfaceState/);
assert.match(state, /nodeId: string \| null/);
assert.match(state, /surface: KnowledgeSurfaceKind/);
assert.match(app, /const knowledgeSurfaceState = new KnowledgeSurfaceState\(\)/,
  'app must own one typed knowledge surface state');
assert.doesNotMatch(app, /currentPanelId/,
  'legacy parallel selected-node flag must be removed');
assert.doesNotMatch(app, /classList\.contains\('open'\)/,
  'app must not infer knowledge surface state from DOM presentation');
assert.doesNotMatch(app, /nodeDetail\?\.isOpenFor|nodeDetail\.isOpenFor/,
  'app must not infer navigation truth from controller render caches');
assert.match(app, /surface === 'panel'\) panel\.openNodePanel\(nodeId\)/,
  'refresh must project the typed panel state');
assert.match(app, /surface === 'detail'\) nodeDetail\?\.refresh\(nodeId\)/,
  'refresh must project the typed detail state');
assert.match(panel, /onNodePanelChange\?: \(id: string \| null\) => void/,
  'panel must expose its semantic lifecycle explicitly');
assert.match(panel, /this\.onNodePanelChange\?\.\(id\)/,
  'panel open must report the selected node');
assert.match(panel, /this\.onNodePanelChange\?\.\(null\)/,
  'panel final close must report no active panel surface');
assert.match(app, /nodeDetail\?\.close\(\);\n  if \(!panel\.openNodeAction/,
  'detail-to-edit transition must transfer ownership instead of stacking two node surfaces');

console.log('Knowledge surface single-owner architecture checks passed');
''')

p = Path('package.json')
s = p.read_text()
old = 'node scripts/verify-projection-edit-delta.mjs"'
new = 'node scripts/verify-projection-edit-delta.mjs && node scripts/verify-knowledge-surface-state.mjs"'
if s.count(old) != 1:
    raise SystemExit('test:architecture LQ-09 anchor mismatch')
p.write_text(s.replace(old, new, 1))
