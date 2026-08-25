from pathlib import Path
import re

# 1. Remove the misleading client-side cascade depth control. Public cascade
# authority lives on the server and recursively covers the whole downstream
# current graph; a browser preference must never truncate shared truth.
p = Path('index.html')
s = p.read_text()
block = '''      <div class="settings-row">
        <label>级联悬置传播层级上限</label>
        <input type="number" id="depthLimit" min="1" placeholder="∞" style="width:70px;">
      </div>
'''
if s.count(block) != 1:
    raise SystemExit('index depthLimit block mismatch')
s = s.replace(block, '', 1)
p.write_text(s)

# 2. Remove app wiring to the dead client setters.
p = Path('src/ui/app.ts')
s = p.read_text()
s = s.replace("import { GraphProjection, setCascadeDepthLimit } from '../projection/GraphProjection';", "import { GraphProjection } from '../projection/GraphProjection';", 1)
s = s.replace("  depthLimit: opt<HTMLInputElement>('depthLimit'),\n", '', 1)
s = s.replace("  depthLimit: null,\n", '', 1)
pattern = re.compile(r"\nconst depthLimitInput = opt<HTMLInputElement>\('depthLimit'\);\nif \(depthLimitInput\) \{\n(?:.|\n)*?\n  applyDepthLimit\(\);\n\}\n", re.MULTILINE)
s, count = pattern.subn('\n', s, count=1)
if count != 1:
    raise SystemExit('app depthLimit runtime block mismatch')
p.write_text(s)

# 3. Remove projection-local cascade reachability/depth state. It was not a
# production authority and had no live caller outside the dead settings path.
p = Path('src/projection/GraphProjection.ts')
s = p.read_text()
s = s.replace("import { cascadeReachable } from '../graph/Graph';\n", '', 1)
s = s.replace("\nlet cascadeDepthLimit = Infinity;\nexport function setCascadeDepthLimit(n: number | null) { cascadeDepthLimit = n ?? Infinity; }\n", '\n', 1)
method = '''\n  reachableForCascade(fromNodeId: string): { ids: string[]; truncated: boolean } {\n    return cascadeReachable(fromNodeId, nodeList(this.state), cascadeDepthLimit);\n  }\n'''
if s.count(method) != 1:
    raise SystemExit('projection reachableForCascade mismatch')
s = s.replace(method, '\n', 1)
p.write_text(s)

# 4. Remove dead graph helpers that existed only to support the projection-local
# client preview path.
p = Path('src/graph/Graph.ts')
s = p.read_text()
start = s.find('\nexport function dependentsOf(')
if start == -1:
    raise SystemExit('Graph dependentsOf anchor missing')
s = s[:start].rstrip() + '\n'
p.write_text(s)

# 5. Remove the explicit no-op from the 3D scene API.
p = Path('src/ui/scene/KnowledgeScene.ts')
s = p.read_text()
s = s.replace('  setCascadeDepthLimit: (n: number | null) => void;\n', '', 1)
s = s.replace('    setCascadeDepthLimit: () => {},\n', '', 1)
p.write_text(s)

# 6. Remove the unused settings element plumbing from PanelController.
p = Path('src/ui/panels/PanelController.ts')
s = p.read_text()
s = s.replace('  depthLimit?: HTMLInputElement;\n', '', 1)
s = s.replace('  private readonly depthLimit?: HTMLInputElement;\n', '', 1)
s = s.replace('    this.depthLimit = options.depthLimit;\n', '', 1)
s = s.replace('    depthLimit?: number | null;\n', '', 1)
block = '''    if (values.depthLimit !== undefined && this.depthLimit) {\n      this.depthLimit.value = values.depthLimit === null ? '' : String(values.depthLimit);\n    }\n'''
if s.count(block) != 1:
    raise SystemExit('PanelController depthLimit setter mismatch')
s = s.replace(block, '', 1)
p.write_text(s)

# 7. Architecture regression guard: client cannot own or truncate public cascade;
# server recursion remains the authoritative implementation.
Path('scripts/verify-cascade-authority.mjs').write_text(r'''import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  app: await readFile('src/ui/app.ts', 'utf8'),
  projection: await readFile('src/projection/GraphProjection.ts', 'utf8'),
  graph: await readFile('src/graph/Graph.ts', 'utf8'),
  scene: await readFile('src/ui/scene/KnowledgeScene.ts', 'utf8'),
  panel: await readFile('src/ui/panels/PanelController.ts', 'utf8'),
  html: await readFile('index.html', 'utf8'),
  cascadeMigration: await readFile('supabase/migrations/202608220008_cascade_revalidation_rounds.sql', 'utf8'),
};

for (const [name, source] of Object.entries(files).filter(([name]) => name !== 'cascadeMigration')) {
  assert.doesNotMatch(source, /depthLimit|setCascadeDepthLimit|reachableForCascade|cascadeReachable/,
    `${name} must not expose a client-side public cascade depth authority`);
}
assert.doesNotMatch(files.graph, /dependentsOf/,
  'dead client-only cascade traversal helper must stay removed');
assert.match(files.cascadeMigration, /with recursive downstream\(node_id\) as \(/,
  'server must recursively enumerate downstream current knowledge');
assert.match(files.cascadeMigration, /perform private\.emit_downstream_revalidation\(/,
  'current-head changes must invoke the authoritative server cascade');
assert.match(files.cascadeMigration, /private\.start_cascade_knowledge_revalidation\(/,
  'server cascade must create real revalidation rounds');
assert.doesNotMatch(files.cascadeMigration, /depth[_ ]?limit/i,
  'authoritative public cascade must not depend on a browser-configurable depth limit');

console.log('Cascade authority regression checks passed');
''')

# 8. Put the regression guard in the existing architecture gate.
p = Path('package.json')
s = p.read_text()
old = 'node scripts/verify-create-ownership.mjs"'
new = 'node scripts/verify-create-ownership.mjs && node scripts/verify-cascade-authority.mjs"'
if s.count(old) != 1:
    raise SystemExit('package test:architecture LQ-11 anchor mismatch')
p.write_text(s.replace(old, new, 1))
