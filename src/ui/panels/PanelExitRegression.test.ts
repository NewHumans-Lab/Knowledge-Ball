import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
assert.match(panel, /type PanelView = 'idle' \| 'action'/, 'panel must model only idle/action state after legacy detail removal');
assert.match(panel, /private panelView: PanelView = 'idle'/, 'panel must not initialize a second detail lifecycle');
assert.match(panel, /this\.panelClose\.addEventListener\('click', \(\) => this\.handlePanelExit\(\)\)/, 'panel close must call the controller-owned exit action directly');
assert.match(panel, /private handlePanelExit\(\): void/, 'panel must expose one explicit exit decision point');
assert.match(panel, /this\.panelView === 'action'/, 'panel exit must distinguish action ownership from idle state');
assert.match(panel, /private returnToNodeDetail\(/, 'action exit must have one explicit return-to-detail boundary');
assert.match(panel, /this\.closeNodePanel\(\);\n\s*if \(targetId\) this\.onSelectRelatedNode\?\.\(targetId\)/, 'return must close the action surface and delegate to the canonical detail navigator');
assert.match(panel, /private enterPanelAction\(id: string\): void/, 'node edit flows must mark explicit action ownership');
assert.match(panel, /this\.enterPanelAction\(id\);\n\s*this\.executeNodeAction\(id, action\)/, 'edit and opposition must enter the action surface without rendering a panel-owned detail first');
assert.doesNotMatch(panel, /bindPanelRuntimeEvents/, 'legacy panel detail event wiring must be removed');
assert.doesNotMatch(panel, /mastery-display/, 'legacy panel detail markup must be removed');
assert.doesNotMatch(panel, /下游依赖节点/, 'legacy panel detail content must not remain hidden in the action controller');
assert.doesNotMatch(panel, /stopImmediatePropagation/, 'panel navigation must never depend on capture interception');
assert.doesNotMatch(panel, /MutationObserver/, 'panel navigation must never infer state from DOM mutations');

const vite = await readFile('vite.config.ts', 'utf8');
assert.doesNotMatch(vite, /ExitUi\.ts/, 'Vite must not inject an exit monkeypatch layer');
assert.equal(existsSync('src/ui/ExitUi.ts'), false, 'legacy ExitUi sidecar must be removed');

const app = await readFile('src/ui/app.ts', 'utf8');
assert.match(app, /import '\.\/ExitControls\.css'/, 'exit visuals must be regular application CSS');
const css = await readFile('src/ui/ExitControls.css', 'utf8');
assert.match(css, /#panelClose/, 'panel close visual must remain explicit');
assert.doesNotMatch(css, /!important/, 'exit visuals must not rely on runtime CSS overrides');

const account = await readFile('src/ui/AccountUi.ts', 'utf8');
assert.match(account, /accountClose\?\.setAttribute\('aria-label', '返回知识球'\)/, 'browser account close must retain an accessible label under its real owner');

console.log('Single-owner panel exit regression tests passed');
