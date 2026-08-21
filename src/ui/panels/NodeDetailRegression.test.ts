import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { formatNodeContributionTime } from './NodeDetailController';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const css = readFileSync('src/ui/panels/NodeDetailPanel.css', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');

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
assert(css.includes('width:min(58vw,220px)'), 'detail surface must keep the approved narrow width');
assert(css.includes('min-height:330px'), 'detail surface must keep the approved vertical-ellipse height');
assert(css.includes('border-radius:50% / 44%'), 'detail separator must remain a vertical ellipse');
assert(css.includes('border:1px solid'), 'detail surface must use an ellipse outline as its separator');
assert(css.includes('background:transparent'), 'detail surface must not restore an opaque black background');
assert(!css.includes('radial-gradient'), 'detail surface must not use the previous black radial fill');
assert(css.includes('font-size:15.5px'), 'knowledge content text must be larger than the previous compact presentation');
assert(css.includes('overflow-y:auto'), 'long knowledge content must scroll inside the fixed-size detail surface');
assert(css.includes('touch-action:pan-y'), 'mobile users must be able to vertically scroll long detail content');
assert(!css.includes('#C85450') && !css.includes('#ff0000'), 'detail close/action styling must not use the old red danger colour');

assert(app.includes('if (!Capacitor.isNativePlatform())'), 'new near-node detail behavior must remain web-only for now');
assert(app.includes('nodeDetail.open(id)'), 'second-tap ordinary-node path must open the near-node detail surface');
assert(app.includes("getMetadata: id =>"), 'detail must receive contributor/time metadata through the production adapter');
assert(app.includes('panel.openNodePanel(id)') && app.includes('launchLegacyPanelAction'), 'legacy large panel must be retained only as the editing engine');

assert(detail.includes("const LABEL_SWITCH_CLASS = 'node-detail-labels-off';"), 'detail must own one explicit knowledge-label visibility switch');
assert(detail.includes('this.setKnowledgeLabelsVisible(false);'), 'opening detail must switch all knowledge labels off');
assert(detail.includes('this.setKnowledgeLabelsVisible(true);'), 'closing detail must switch knowledge labels back on');
assert(css.includes('html.node-detail-labels-off .node-label'), 'the detail label switch must target every knowledge-node label');
assert(css.includes('display:none!important'), 'the detail label switch must override per-frame inline label visibility while active');
assert(detail.includes('this.onDetailNodeChange(null);'), 'closing detail must also release selected-node detail ownership');

console.log('Near-node detail regression tests passed');
