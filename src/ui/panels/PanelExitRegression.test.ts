import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const panel = await readFile('src/ui/panels/PanelController.ts', 'utf8');
assert.match(panel, /type PanelView = 'detail' \| 'subview'/, 'panel must own explicit detail/subview navigation state');
assert.match(panel, /private panelView: PanelView = 'detail'/, 'panel must initialize its own navigation state');
assert.match(panel, /this\.panelClose\.addEventListener\('click', \(\) => this\.handlePanelExit\(\)\)/, 'panel close must call the controller-owned exit action directly');
assert.match(panel, /private handlePanelExit\(\): void/, 'panel must expose one explicit exit decision point');
assert.match(panel, /this\.panelView === 'subview'/, 'panel exit must distinguish subviews from node detail');
assert.match(panel, /this\.returnToNodeDetail\(\)/, 'subview exit must return directly to the selected node detail');
assert.match(panel, /this\.enterPanelSubview\(id\)/, 'node edit flows must mark explicit subview ownership');
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

console.log('Explicit panel exit ownership regression tests passed');
