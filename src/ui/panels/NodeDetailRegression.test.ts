import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { formatNodeContributionTime, relationNodeTextColor } from './NodeDetailController';
import { NODE_LAYER_COLOR_HEX, NODE_SPECIAL_COLOR_HEX } from '../config/KnowledgeUiConfig';

const detail = readFileSync('src/ui/panels/NodeDetailController.ts', 'utf8');
const css = readFileSync('src/ui/panels/NodeDetailPanel.css', 'utf8');
const app = readFileSync('src/ui/app.ts', 'utf8');
const scene = readFileSync('src/ui/scene/KnowledgeScene.ts', 'utf8');
const relationDomain = readFileSync('src/domain/KnowledgeRelations.ts', 'utf8');

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
for (const action of ['优化', '新增', '新增推理', '提出对立观点', '分解']) {
  assert(detail.includes(action), `single detail engine must expose ${action}`);
}
assert(!detail.includes("derive: '基于此新增'"), 'legacy combined 基于此新增 action must stay removed');
assert(!detail.includes("merge: '合并'") && !detail.includes("| 'merge'"), 'removed merge action must not return to the detail engine');
assert(detail.includes("derive: '新增'") && detail.includes("'derive-reasoning': '新增推理'"), 'detail must expose two explicit create actions');
assert(!detail.includes('NodeDetailControllerLegacy'), 'detail must not inherit from a copied legacy controller');
assert.equal(existsSync('src/ui/panels/NodeDetailLineageUi.ts'), false, 'near-node detail must have exactly one DOM/lifecycle owner');
assert(!app.includes('NodeDetailLineageUi') && !app.includes('nodeDetailLineageUi'), 'app must not coordinate a second detail lifecycle');

// One canonical relation model owns the scene line and the detail axes. A
// reasoning-process ball is a real node in previous/next, not a hidden edge
// label or a separate logic relation.
assert(relationDomain.includes('export interface KnowledgeRelations'), 'four-direction relation contract must live in the domain layer');
for (const direction of ['previous', 'next', 'history', 'opposition']) {
  assert(relationDomain.includes(`${direction}: KnowledgeRelationItem[]`), `canonical relation model must expose ${direction}`);
  assert(detail.includes(`'${direction}'`), `detail must render the canonical ${direction} axis`);
}
assert(relationDomain.includes('collectKnowledgeChainEdges'), 'scene and detail must share canonical chain ownership');
assert(relationDomain.includes('logicRuleId is metadata'), 'logic rule identity must be explicitly separated from visual chain truth');
assert(!relationDomain.includes('twinGroup'), 'legacy twin UI metadata must not enter canonical relation truth');
assert(app.includes('knowledgeRelationIndex.relationsFor(id)'), 'detail must consume the canonical indexed domain relation projection');
assert(scene.includes('relationIndexFor(nodes).edges'), 'scene lines must consume the same canonical indexed domain chain');
assert(!scene.includes('n.logicRuleId ? [n.logicRuleId]'), 'scene must not redraw logic metadata as a relation line');
assert(!scene.includes("join('<->')"), 'scene must not redraw legacy twin links');
assert(detail.includes('data-related-node-id='), 'near-node relations must preserve each projected related node id in the DOM');
assert(detail.includes('data-relation-kind='), 'near-node relations must preserve the four canonical directions');
assert(detail.includes('data-relation-count='), 'each relation rail must expose its real item count for layout diagnostics');
assert(detail.includes('this.onSelectRelatedNode(relatedId)'), 'relation controls must delegate navigation instead of opening nodes locally');
assert(!detail.includes('items.map(item => `<span>'), 'related nodes must not regress to non-interactive decorative spans');
assert.equal((app.match(/onSelectRelatedNode:\s*openNode/g) ?? []).length, 2, 'editing panel and near-node detail must share the same openNode navigation authority');
assert(css.includes('.node-detail-relation{'), 'related nodes must have one explicit button style');
assert(css.includes('pointer-events:auto'), 'related-node buttons must remain pointer-interactive');
assert(css.includes('.node-detail-relation:hover') && css.includes('.node-detail-relation:focus-visible'), 'related-node controls must expose pointer and keyboard interaction affordances');

// The local navigator text is a label for the real node ball, not a new semantic
// colour system. Verify the same scene priority including explicit outer facts.
assert.equal(
  relationNodeTextColor({ id: 'reasoning', title: '推理', type: 'reasoning', status: 'verified' }),
  NODE_SPECIAL_COLOR_HEX.structural,
  'white structural reasoning ball must produce white structural relation text',
);
assert.equal(
  relationNodeTextColor({ id: 'outer-fact', title: '外层事实', type: 'fact', status: 'verified', declaredLayer: 'outer' }),
  NODE_LAYER_COLOR_HEX.outer,
  'declared outer fact must use its real outer-layer ball colour instead of a type fallback',
);
assert.equal(
  relationNodeTextColor({ id: 'disputed', title: '争议', type: 'definition', status: 'disputed', declaredLayer: 'inner' }),
  NODE_LAYER_COLOR_HEX.outer,
  'disputed current node must use the same outer-layer display colour as its ball',
);
assert.equal(
  relationNodeTextColor({ id: 'history', title: '历史', type: 'definition', status: 'verified', lineage: { topicId: 't', proposal: 'optimization', targetId: 'current', role: 'history', rank: 1 } }),
  '#8A949E',
  'history text must use the same gray as a history ball',
);
assert.equal(
  relationNodeTextColor({ id: 'opposition', title: '对立', type: 'definition', status: 'verified', lineage: { topicId: 't', proposal: 'opposition', targetId: 'current', role: 'opposition', rank: 1 } }),
  '#EE5B63',
  'opposition text must use the same red as an opposition ball',
);
assert(detail.includes('--relation-node-color'), 'relation markup must carry the real node colour into CSS without a direction colour table');
assert(relationDomain.includes('declaredLayer: node.declaredLayer'), 'relation items must preserve the node declaration needed to reproduce its actual scene layer colour');

assert(detail.includes("node.status === 'pending'"), 'flashing/pending nodes must use the pending interaction branch');
assert(detail.includes('node-detail-vote-title">投票<'), 'pending detail must replace the edit entry with a vote heading');
assert(detail.includes('data-vote-side="AGREE" disabled><span>同意</span><small>能量 −1</small>'), 'pending detail must expose the agree one-energy action');
assert(detail.includes('data-vote-side="DISAGREE" disabled><span>反对</span><small>能量 −1</small>'), 'pending detail must expose the disagree one-energy action');
assert(detail.includes('account.getPendingKnowledgeVote(nodeId)'), 'near-node vote controls must read the authoritative existing vote state');
assert(detail.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'near-node vote controls must reuse the real existing vote RPC');
assert(detail.includes("knowledge-ball:verdict-finalized"), 'near-node finalization must reuse the existing graph reconciliation signal');
assert(detail.includes('VOTE_REFRESH_MS = 3_000'), 'near-node vote tally must retain the existing prompt refresh cadence');
assert(app.includes('actorId: metadata.actorId'), 'near-node detail must receive contributor metadata through the authoritative adapter');
assert(detail.includes('await account.currentUserId()'), 'initial pending detail must compare the current account with the node creator');
assert(detail.includes("this.root.dataset.voteCreator = '1'"), 'initial creator identity must lock the first-round vote controls');
assert(detail.includes('你是该知识的提交者，不能参与本轮投票'), 'first-round creator must see an explicit no-self-vote explanation');
assert(detail.includes('data-vote-side="AGREE" disabled') && detail.includes('data-vote-side="DISAGREE" disabled'), 'vote buttons must stay disabled until identity and server state are known');
assert(detail.includes("typeof window === 'undefined'"), 'vote client creation must stay browser-lazy so pure node-detail tests do not require Vite runtime env');
assert(!detail.includes('const voteAccount = createProductionAuthClient()'), 'vote client must not initialize at module import time');
assert(!detail.includes('setInterval('), 'near-node voting must not add a permanent polling interval');

// Human V1 revalidation must show the stake before confirmation using the
// authoritative next topic stage. The first 30 stages show 10; later stages
// are allowed to update the same label from the server quote (20, 30, ...).
assert(detail.includes('data-reactivation-stake>能量 −10</small>'), 'revalidation entry must visibly start with the first-tier ten-energy cost');
assert(detail.includes('account.getKnowledgeRevalidationQuote(nodeId)'), 'revalidation entry must read the authoritative next-stage stake before enabling confirmation');
assert(detail.includes('stakeLabel.textContent = `能量 −${displayEnergy(quote.stake)}`'), 'revalidation entry must replace the visible cost with the server-quoted stage stake');
assert(detail.includes('intent.disabled = false'), 'revalidation intent must stay disabled until the stake quote is known');
assert(detail.includes('button.querySelector(\'small\')!.textContent = `能量 −${displayEnergy(snapshot.stake)}`'), 'active revalidation votes must continue to display the exact round stake');

// Automatic dependency cascade is a focused V3 enhancement, not a copied
// detail controller. It reuses the authoritative pending-vote RPC.
assert(detail.includes("role === 'current' && node.status === 'disputed'"), 'cascade interaction must attach only to disputed current nodes');
assert(detail.includes("snapshot.roundKind !== 'CASCADE'"), 'cascade interaction must require the explicit server-created CASCADE round kind');
assert(!detail.includes("snapshot.policyVersion !== 'ORIGINAL_DESIGN_V1'"), 'cascade interaction must not infer round semantics from human V1 policy identity');
assert(detail.includes('data-cascade-vote-side="AGREE"'), 'cascade interaction must expose agree');
assert(detail.includes('data-cascade-vote-side="DISAGREE"'), 'cascade interaction must expose disagree');
assert(detail.includes('能量 −1'), 'cascade ordinary vote cost must remain one energy');
assert(detail.includes('无发起人、无发起人票'), 'cascade interaction must state the no-initiator rule');
assert(detail.includes('account.castPendingKnowledgeVote(nodeId, side)'), 'cascade must reuse the authoritative pending-vote RPC');
assert(detail.includes('VOTE_REFRESH_MS = 3_000'), 'cascade tally must reuse the detail owner polling cadence without a permanent interval');
assert(detail.includes("knowledge-ball:verdict-finalized"), 'cascade finalization must request public-stream convergence');
assert(!detail.includes('setInterval('), 'single detail owner must not add a permanent polling interval');
assert.equal((detail.match(/private currentId:/g) ?? []).length, 1, 'single detail owner must keep exactly one selected-node lifecycle state');
assert.equal((detail.match(/private voteRefreshTimer:/g) ?? []).length, 1, 'INITIAL, V1 and CASCADE interactions must share one refresh timer owner');

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
assert(css.includes('--detail-body-font-size:16px'), 'desktop knowledge content and neighbour labels must share the 16px body token');
assert(css.includes('--detail-body-font-family') && css.includes('--detail-body-font-weight:400'), 'knowledge content and neighbour labels must share one font family and weight');
assert(css.includes('font-size:var(--detail-body-font-size)') && css.includes('font-weight:var(--detail-body-font-weight)'), 'neighbour labels must consume the same typography tokens as middle content');
assert(css.includes('.node-detail-title{font-size:19px;}'), 'mobile node title must use 19px');
assert(css.includes('--detail-body-font-size:15px'), 'mobile middle content and neighbour labels must both use 15px');
assert(css.includes('.node-detail-content{max-height:116px;}'), 'mobile knowledge content must retain its approved scroll height');
assert(css.includes('right:calc(100% + var(--detail-relation-offset))') && css.includes('left:calc(100% + var(--detail-relation-offset))'), 'left/right relation rails must use the same ellipse offset');
assert(css.includes('bottom:calc(100% + var(--detail-relation-offset))') && css.includes('top:calc(100% + var(--detail-relation-offset))'), 'top/bottom relation rails must use the same ellipse offset');
assert(css.includes('transform:translateY(-50%)'), 'any-size side relation list must stay centred on the ellipse horizontal axis');
assert(css.includes('flex-flow:row wrap') && css.includes('justify-content:center') && css.includes('align-content:center'), 'any-size top/bottom relation set must wrap into centred rows');
assert(css.includes('max-height:min(58vh,330px)') && css.includes('overflow-y:auto'), 'large side relation sets must remain bounded and scrollable rather than clipping or drifting');
assert(css.includes('margin-top:auto'), 'contributor/time metadata must sit at the bottom of the detail surface');
assert(css.includes('flex-direction:column'), 'contributor and time must remain stacked on two rows');
assert(css.includes('touch-action:pan-y'), 'mobile users must be able to vertically scroll long detail content');
assert(!css.includes('#C85450') && !css.includes('#ff0000'), 'detail close/action styling must not use the old red danger colour');

assert(app.includes('if (!Capacitor.isNativePlatform())'), 'new near-node detail behavior must remain web-only for now');
assert(app.includes('nodeDetail.open(id)'), 'ordinary-node path must open the near-node detail surface');
assert(detail.includes('this.onViewed?.(id);'), 'detail owner must emit viewed only after the detail surface has been rendered and opened');
assert(app.includes('onViewed: id => { void markNodeViewed(id); }'), 'app mastery write must be wired to the rendered-detail viewed signal');
const openNodeSource = app.slice(app.indexOf('function openNode('), app.indexOf('function updateSceneOverlayState'));
assert(!openNodeSource.includes('markNodeViewed'), 'scene selection/openNode intent must not itself mark mastery');
assert(app.includes("getMetadata: id =>"), 'detail must receive contributor/time metadata through the production adapter');
assert(app.includes('panel.openNodePanel(id)') && app.includes('launchPanelAction'), 'large panel must remain the single editing surface behind non-create detail actions');

assert(detail.includes("const LABEL_SWITCH_CLASS = 'node-detail-labels-off';"), 'detail must own one explicit knowledge-label visibility switch');
assert(detail.includes('this.setKnowledgeLabelsVisible(false);'), 'opening detail must switch all knowledge labels off');
assert(detail.includes('this.setKnowledgeLabelsVisible(true);'), 'closing detail must switch knowledge labels back on');
assert(css.includes('html.node-detail-labels-off .node-label'), 'the detail label switch must target every knowledge-node label');
assert(css.includes('display:none!important'), 'the detail label switch must override per-frame inline label visibility while active');
assert(detail.includes('this.onDetailNodeChange(null);'), 'closing detail must also release selected-node detail ownership');

console.log('Near-node detail canonical relation regression tests passed');
