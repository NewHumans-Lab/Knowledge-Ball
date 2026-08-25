from pathlib import Path

p = Path('src/ui/panels/PanelController.ts')
s = p.read_text()
s = s.replace('  onCreateNode: (payload: CreateNodePayload) => Promise<void> | void;\n', '  onCreateNode?: (payload: CreateNodePayload) => Promise<void> | void;\n', 1)
s = s.replace('  private readonly onCreateNode: (payload: CreateNodePayload) => Promise<void> | void;\n', '  private readonly onCreateNode?: (payload: CreateNodePayload) => Promise<void> | void;\n', 1)
old = '        <button class="btn ghost" id="btnDeriveNode">Add · 新增</button>\n'
new = "        ${this.onCreateNode ? '<button class=\"btn ghost\" id=\"btnDeriveNode\">Add · 新增</button>' : ''}\n"
if s.count(old) != 1:
    raise SystemExit('legacy derive button anchor mismatch')
s = s.replace(old, new, 1)
old = '''  openCreateModal(prefillPremiseId: string | null = null): void {
    this.prefillPremise = prefillPremiseId;
'''
new = '''  openCreateModal(prefillPremiseId: string | null = null): void {
    // Legacy combined create remains a native compatibility surface only. Web
    // production intentionally uses KnowledgeCreateController's split flows.
    if (!this.onCreateNode) return;
    this.prefillPremise = prefillPremiseId;
'''
if s.count(old) != 1:
    raise SystemExit('openCreateModal anchor mismatch')
s = s.replace(old, new, 1)
old = '''      this.modalSubmit.disabled = true;
      try {
        await this.onCreateNode({
'''
new = '''      if (!this.onCreateNode) return;
      this.modalSubmit.disabled = true;
      try {
        await this.onCreateNode({
'''
if s.count(old) != 1:
    raise SystemExit('modal submit callback anchor mismatch')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('src/ui/app.ts')
s = p.read_text()
old = '  onCreateNode: createKnowledgeNode,\n'
new = '  onCreateNode: Capacitor.isNativePlatform() ? createKnowledgeNode : undefined,\n'
if s.count(old) != 1:
    raise SystemExit('app legacy create wiring anchor mismatch')
p.write_text(s.replace(old, new, 1))

Path('scripts/verify-create-ownership.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile('src/ui/app.ts', 'utf8');
const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
const split = await readFile('src/ui/panels/KnowledgeCreateController.ts', 'utf8');

assert.match(app, /onCreateNode: Capacitor\.isNativePlatform\(\) \? createKnowledgeNode : undefined/,
  'legacy combined create must be wired only on native compatibility surfaces');
assert.match(app, /knowledgeCreate = new KnowledgeCreateController/,
  'split create controller remains the canonical product controller');
assert.match(app, /knowledgeCreate\.openStandalone\(\)/,
  'standalone creation must remain available');
assert.match(app, /knowledgeCreate\.openReasoning\(/,
  'reasoning creation must remain available');
assert.match(panel, /onCreateNode\?: \(payload: CreateNodePayload\)/,
  'legacy create callback must be optional rather than a universal panel dependency');
assert.match(panel, /if \(!this\.onCreateNode\) return;[\s\S]*this\.prefillPremise = prefillPremiseId/,
  'web panel must not open the legacy combined create modal when it has no owner');
assert.match(panel, /this\.onCreateNode \? '<button class="btn ghost" id="btnDeriveNode">Add · 新增<\/button>' : ''/,
  'legacy Add control must only render where the native compatibility callback exists');
assert.match(split, /type CreateMode = 'standalone' \| 'reasoning'/,
  'canonical split create modes must remain explicit');
assert.match(split, /新增只创建一个独立知识球/,
  'standalone semantics must not be folded back into the legacy generic form');
assert.match(split, /结论[\s\S]*搜索已有结论节点/,
  'reasoning flow must retain explicit existing-conclusion selection');

console.log('Create ownership isolation checks passed');
''')

p = Path('package.json')
s = p.read_text()
old = 'node scripts/verify-knowledge-surface-state.mjs"'
new = 'node scripts/verify-knowledge-surface-state.mjs && node scripts/verify-create-ownership.mjs"'
if s.count(old) != 1:
    raise SystemExit('test:architecture LQ-10 anchor mismatch')
p.write_text(s.replace(old, new, 1))
