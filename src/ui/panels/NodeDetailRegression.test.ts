import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { formatNodeContributionTime } from './NodeDetailController';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const lineageUi = readFileSync('src/ui/panels/NodeDetailLineageUi.ts', 'utf8');
const css = readFileSync('src/ui/panels/NodeDetailPanel.css', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');

assert.equal(existsSync('src/ui/panels/NodeDetailControllerLegacy.ts'), false, 'there must be one NodeDetailController implementation');
assert.equal(formatNodeContributionTime(undefined), '—');
assert.equal(formatNodeContributionTime('invalid'), '—');
assert.match(formatNodeContributionTime('2026-08-21T04:00:00.000Z'), /^2026-08-21\s/);

for (const text of ['贡献者 ·', '时间 ·', '>编辑<']) {
  assert(detail.includes(text), `near-node detail must render ${text}`);
}
assert(!detail.includes('node-detail-content-label'), 'near-node detail must not render a redundant content label');
assert(!detail.includes('>内容<'), 'the standalone content heading must stay removed');
assert(detail.indexOf('node-detail-content') < detail.indexOf('node-detail-meta'), 'knowledge content must appear before contributor/time metadata');
assert(detail.indexOf('贡献者 ·') < detail.indexOf('时间 ·'), 'contributor and time must remain two ordered footer rows');
for (const action of ['优化', '基于此新增', '提出对立观点', '分解', '合并']) {
  assert(detail.includes(action), `single detail engine must expose ${action}`);
}
assert(!detail.includes('NodeDetailControllerLegacy'), 'detail must not inherit from a copied legacy controller');
assert(!lineageUi.includes('relabelActions'), 'cascade helper must not rewrite ordinary detail action labels after render');
assert(!lineageUi.includes('data-node-detail-action="edit"') && !lineageUi.includes('data-node-detail-action="negate"'), 'cascade helper must not own ordinary edit/opposition presentation');

assert(detail.includes("node.status === 'pending'"), 'flashing/pending nodes must use the pending interaction branch');
assert(detail.includes('node-detail-vote-title">投票<'), 'pending detail must replace the edit entry with a vote heading');
assert(detail.includes('data-vote-side="AGREE" disabled><span>同意</span><small>能量 −1</small>'), 'pending detail must expose the agree one-energy action');
assert(detail.includes('data-vote-side="DISAGREE" disabled><span>反对</span><small>能量 −1</small>'), 'pending detail must expose the disagree one-energy action');
assert(detail.includes('account.getPendingKnowledgeVote(nodeId)'), 'near-node vote controls must read the authoritative existing vote state');
assert(detail.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'near-node vote controls must reuse the real existing vote RPC');
assert(detail.includes("knowledge-ball:verdict-finalized"), 'near-node finalization must reuse the existing graph reconciliation signal');
assert(detail.includes('VOTE_REFRESH_MS = 3_000'), 'near-node vote tally must retain the existing prompt refresh cadence');
assert(app.includes('actorId: metadata.actorId'), 'near-node detail must receive the authoritative creator actor id');
assert(detail.includes('await account.currentUserId()'), 'initial pending detail must compare the current account with the node creator');
assert(detail.includes("this.root.dataset.voteCreator = '1'"), 'initial creator identity must lock the first-round vote controls');
assert(detail.includes('你是该知识的提交者，不能参与本轮投票'), 'first-round creator must see an explicit no-self-vote explanation');
assert(detail.includes('data-vote-side="AGREE" disabled') && detail.includes('data-vote-side="DISAGREE" disabled'), 'vote buttons must stay disabled until identity and server state are known');
assert(detail.includes("typeof window === 'undefined'"), 'vote client creation must stay browser-lazy so pure node-detail tests do not require Vite runtime env');
assert(!detail.includes('const voteAccount = createProductionAuthClient()'), 'vote client must not initialize at module import time');
assert(!detail.includes('setInterval('), 'near-node voting must not add a permanent polling interval');

// Automatic dependency cascade is a focused V3 enhancement, not a copied
// detail controller. It reuses the authoritative pending-vote RPC.
assert(lineageUi.includes('class NodeDetailLineageUi'), 'lineage detail enhancement must have one narrow owner');
assert(lineageUi.includes("node.status !== 'disputed' || lineageRoleFor(node) !== 'current'"), 'cascade UI must attach only to disputed current nodes');
assert(lineageUi.includes("snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1'"), 'cascade UI must require the server-created V1 pending round');
assert(lineageUi.includes('data-cascade-vote-side="AGREE"'), 'cascade UI must expose agree');
assert(lineageUi.includes('data-cascade-vote-side="DISAGREE"'), 'cascade UI must expose disagree');
assert(lineageUi.includes('能量 −1'), 'cascade ordinary vote cost must remain one energy');
assert(lineageUi.includes('无发起人、无发起人票'), 'cascade UI must state the no-initiator rule');
assert(lineageUi.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'cascade must reuse the authoritative pending-vote RPC');
assert(lineageUi.includes('REFRESH_MS = 3_000'), 'cascade tally must refresh without a permanent interval');
assert(lineageUi.includes("knowledge-ball:verdict-finalized"), 'cascade finalization must request public-stream convergence');
assert(!lineageUi.includes('setInterval('), 'cascade must not add a permanent polling interval');
assert(app.includes('nodeDetailLineageUi?.open(id)') && app.includes('nodeDetailLineageUi?.refresh(currentPanelId)'), 'app must explicitly start and refresh lineage detail enhancement with the detail lifecycle');

assert(css.includes('grid-template-columns:1fr 1fr'), 'agree and disagree must stay side by side in one row');
assert(css.includes('.node-detail-vote-button span{font-size:12px'), 'vote choice must be the primary line in each button');
assert(css.includes('.node-detail-vote-button small{font-size:9.5px'), 'one-energy cost must remain the smaller second line');

assert(detail.includes('node-detail-close'), 'detail must expose a top-right close control');
assert(css.includes('z-index:70'), 'near-node detail must render closer than the WebGL canvas and labels');
assert(css.includes('width:min(58vw,220px)'), 'detail surface must keep the approved narrow width');
assert(css.includes('min-height:330px'), 'detail surface must keep the approved vertical-ellipse height');
assert(css.includes('border-radius:50% / 44%'), 'detail occlusion must keep the approved vertical-ellipse shape');
assert(css.includes('background:radial-gradient('), 'detail surface must keep the radial occlusion');
assert(css.includes('rgba(3,5,18,.99) 0%'), 'detail occlusion must keep the strong center mask');
assert(!css.includes('border:1px solid rgba(151,205,255,.46)'), 'detail surface must not draw the removed ellipse outline');
assert(css.includes('justify-content:flex-start'), 'detail hierarchy must start near the top rather than vertically centering the whole stack');
assert(css.includes('font:700 20px/1.38'), 'desktop node title must keep the 20px primary type size');
assert(css.includes('font-size:16px'), 'desktop knowledge content must be two visual steps smaller than the 20px title');
assert(css.includes('.node-detail-title{font-size:19px;}'), 'mobile node title must use 19px');
assert(css.includes('.node-detail-content{max-height:116px;font-size:15px;}'), 'mobile knowledge content must stay two visual steps smaller than the 19px title');
assert(css.includes('margin-top:auto'), 'contributor/time metadata must sit at the bottom of the detail surface');
assert(css.includes('flex-direction:column'), 'contributor and time must remain stacked on two rows');
assert(css.includes('overflow-y:auto'), 'long knowledge content must scroll inside the fixed-size detail surface');
assert(css.includes('touch-action:pan-y'), 'mobile users must be able to vertically scroll long detail content');
assert(!css.includes('#C85450') && !css.includes('#ff0000'), 'detail close/action styling must not use the old red danger colour');

assert(app.includes('if (!Capacitor.isNativePlatform())'), 'new near-node detail behavior must remain web-only for now');
assert(app.includes('nodeDetail.open(id)'), 'ordinary-node path must open the near-node detail surface');
assert(app.includes("getMetadata: id =>"), 'detail must receive contributor/time metadata through the production adapter');
assert(app.includes('panel.openNodePanel(id)') && app.includes('launchPanelAction'), 'large panel must remain the single editing surface behind detail actions');

assert(detail.includes("const LABEL_SWITCH_CLASS = 'node-detail-labels-off';"), 'detail must own one explicit knowledge-label visibility switch');
assert(detail.includes('this.setKnowledgeLabelsVisible(false);'), 'opening detail must switch all knowledge labels off');
assert(detail.includes('this.setKnowledgeLabelsVisible(true);'), 'closing detail must switch knowledge labels back on');
assert(css.includes('html.node-detail-labels-off .node-label'), 'the detail label switch must target every knowledge-node label');
assert(css.includes('display:none!important'), 'the detail label switch must override per-frame inline label visibility while active');
assert(detail.includes('this.onDetailNodeChange(null);'), 'closing detail must also release selected-node detail ownership');

console.log('Near-node detail regression tests passed');
