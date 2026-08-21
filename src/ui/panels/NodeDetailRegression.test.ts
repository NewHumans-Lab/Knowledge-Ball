import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { formatNodeContributionTime } from './NodeDetailController';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const css = readFileSync('src/ui/panels/NodeDetailPanel.css', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');
const scene = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');

assert.equal(formatNodeContributionTime(undefined), '—');
assert.equal(formatNodeContributionTime('invalid'), '—');
assert.match(formatNodeContributionTime('2026-08-21T04:00:00.000Z'), /^2026-08-21\s/);

for (const text of ['贡献者 ·', '时间 ·', '>内容<', '>编辑<']) {
  assert(detail.includes(text), `near-node detail must render ${text}`);
}
assert(!detail.includes('知识节点内容'), 'near-node detail content label must stay concise');
for (const action of ['修改内容', '基于此新增', '否定', '分解', '合并']) {
  assert(detail.includes(action), `edit menu must consolidate ${action}`);
}
assert(detail.includes('node-detail-close'), 'detail must expose a top-right close control');
assert(css.includes('z-index:70'), 'near-node detail must render closer than the WebGL canvas and labels');
assert(css.includes('width:min(58vw,220px)'), 'detail surface must stay narrow enough to leave room for premise/conclusion context at the sides');
assert(css.includes('min-height:330px'), 'detail surface must use a vertical-ellipse proportion');
assert(css.includes('border-radius:50% / 44%'), 'detail occlusion surface must read as a vertical ellipse rather than a rectangle');
assert(css.includes('radial-gradient'), 'detail surface must occlude the sphere without restoring a large rectangular panel');
assert(!css.includes('#C85450') && !css.includes('#ff0000'), 'detail close/action styling must not use the old red danger colour');

assert(app.includes('if (!Capacitor.isNativePlatform())'), 'new near-node detail behavior must remain web-only for now');
assert(app.includes('nodeDetail.open(id)'), 'second-tap ordinary-node path must open the near-node detail surface');
assert(app.includes("getMetadata: id =>"), 'detail must receive contributor/time metadata through the production adapter');
assert(app.includes('panel.openNodePanel(id)') && app.includes('launchLegacyPanelAction'), 'legacy large panel must be retained only as the editing engine');

assert(scene.includes('let detailNodeId: string | null = null;'), 'scene must track the one node whose label is replaced by detail content');
assert(scene.includes("setDetailNode: id =>"), 'scene runtime must expose explicit detail-label ownership');
assert(scene.includes("visible && detailNodeId !== id ? '' : 'none'"), 'opening detail must hide only the selected label, not the sphere');
assert(scene.includes('&& detailNodeId !== n.id'), 'per-frame label layout must keep the selected label hidden while detail is open');
assert(detail.includes('this.onDetailNodeChange(null);'), 'closing detail must restore normal label rendering');

console.log('Near-node detail regression tests passed');
