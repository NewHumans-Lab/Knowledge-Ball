import {
  compactEnergy,
  createProductionAuthClient,
  type AccountProfile,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
} from '../auth/AuthClient';
import { safeAvatarUrl } from '../auth/AuthProfilePresentation';
import { setMastery } from '../command/SetMastery';

interface DebugState {
  store?: Parameters<typeof setMastery>[0];
  projection?: { state?: { nodesById?: Record<string, { id:string; title:string; mastery?:string; status?:string }> } };
}
declare global { interface Window { __debug?: DebugState; } }

const account = createProductionAuthClient();
let cached: AccountProfile | null = null;
let markingNode = false;
let voteRenderToken = 0;
let voteRefreshTimer: number | null = null;
let expirySweepTimer: number | null = null;
const VOTE_REFRESH_MS = 3_000;
const EXPIRY_SWEEP_MS = 5 * 60_000;

function start(): void {
  installStyles();
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.avatar-btn') : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation(); openAccount();
  }, true);

  const panelClose = document.getElementById('panelClose');
  if (panelClose) {
    panelClose.textContent = '❌';
    panelClose.setAttribute('aria-label', '返回知识球');
    panelClose.setAttribute('title', '返回知识球');
  }

  // Observe only the node-title signal. The panel-body/actions enhancements below
  // intentionally mutate other panel descendants; observing the whole subtree
  // would recreate the self-feedback loop fixed in PR #54.
  const panelTitle = document.getElementById('panelTitle');
  if (panelTitle) new MutationObserver(() => {
    void markViewedNode();
    void renderPendingVoteControls();
  }).observe(panelTitle, { subtree:true, childList:true, characterData:true });

  updateAvatar();
  if (account) void account.publicSession().then(async () => {
    await loadAccount();
    await sweepExpiredVoteRounds();
    scheduleExpirySweep();
  }).catch(() => scheduleExpirySweep());
}

function currentPanelNode(): { id:string; title:string; mastery?:string; status?:string } | null {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return null;
  const title = document.getElementById('panelTitle')?.textContent?.trim();
  const nodes = window.__debug?.projection?.state?.nodesById;
  if (!title || !nodes) return null;
  return Object.values(nodes).find(candidate => candidate.title === title) ?? null;
}

async function markViewedNode(): Promise<void> {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return;
  panel.querySelector<HTMLElement>('.mastery-demo-controls')?.remove();
  const privacy = panel.querySelector<HTMLElement>('.mastery-private');
  if (privacy) privacy.textContent = 'LOCAL ONLY · 查看即自动点亮，只保存在当前设备';
  const node = currentPanelNode();
  const debug = window.__debug;
  if (!node || !debug?.store || markingNode || node.mastery !== 'none') return;
  markingNode = true;
  try { await setMastery(debug.store, { nodeId:node.id, mastery:'touched' }); } finally { markingNode = false; }
}

function clearVoteRefresh(): void {
  if (voteRefreshTimer !== null) window.clearTimeout(voteRefreshTimer);
  voteRefreshTimer = null;
}

async function renderPendingVoteControls(): Promise<void> {
  const token = ++voteRenderToken;
  clearVoteRefresh();
  const panel = document.getElementById('panel');
  const actions = document.getElementById('panelActions');
  actions?.querySelector('.kb-pending-vote')?.remove();
  const node = currentPanelNode();
  if (!panel?.classList.contains('open') || !actions || !node || node.status !== 'pending') return;

  const root = document.createElement('section');
  root.className = 'kb-pending-vote';
  root.dataset.nodeId = node.id;
  root.innerHTML = `
    <div class="kb-vote-heading"><b>待验证投票</b><span>每票质押 1 能量</span></div>
    <div class="kb-vote-grid">
      <button class="btn confirm kb-vote-button" type="button" data-vote-side="AGREE"><span>赞成</span><small>−1 能量</small></button>
      <button class="btn danger kb-vote-button" type="button" data-vote-side="DISAGREE"><span>反对</span><small>−1 能量</small></button>
    </div>
    <div class="kb-vote-status" role="status" aria-live="polite">${account ? '正在同步全网投票状态…' : '共享服务未配置，暂不能投票'}</div>`;
  actions.prepend(root);

  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
  if (!account) {
    buttons.forEach(button => { button.disabled = true; });
    return;
  }

  buttons.forEach(button => button.addEventListener('click', () => {
    const side = button.dataset.voteSide as PendingVoteSide | undefined;
    if (side === 'AGREE' || side === 'DISAGREE') void castPendingVote(node.id, side, root);
  }));

  try {
    const snapshot = await account.getPendingKnowledgeVote(node.id);
    if (token !== voteRenderToken || !root.isConnected || currentPanelNode()?.id !== node.id) return;
    applyVoteSnapshot(root, snapshot);
    if (snapshot.verdict === 'PENDING') scheduleVoteRefresh(node.id, root, token);
    else await handleFinalizedVote(root, snapshot);
  } catch (error) {
    if (token !== voteRenderToken || !root.isConnected) return;
    const status = root.querySelector<HTMLElement>('.kb-vote-status');
    if (status) status.textContent = error instanceof Error ? error.message : '投票状态读取失败';
  }
}

function scheduleVoteRefresh(nodeId: string, root: HTMLElement, token: number): void {
  clearVoteRefresh();
  voteRefreshTimer = window.setTimeout(() => {
    voteRefreshTimer = null;
    void refreshPendingVote(nodeId, root, token);
  }, VOTE_REFRESH_MS);
}

async function refreshPendingVote(nodeId: string, root: HTMLElement, token: number): Promise<void> {
  if (!account || token !== voteRenderToken || !root.isConnected || currentPanelNode()?.id !== nodeId) return;
  try {
    const snapshot = await account.getPendingKnowledgeVote(nodeId);
    if (token !== voteRenderToken || !root.isConnected || currentPanelNode()?.id !== nodeId) return;
    applyVoteSnapshot(root, snapshot);
    if (snapshot.verdict === 'PENDING') scheduleVoteRefresh(nodeId, root, token);
    else await handleFinalizedVote(root, snapshot);
  } catch (error) {
    const status = root.querySelector<HTMLElement>('.kb-vote-status');
    if (status) status.textContent = error instanceof Error ? `同步失败：${error.message}` : '投票状态同步失败';
    if (document.visibilityState !== 'hidden') scheduleVoteRefresh(nodeId, root, token);
  }
}

async function castPendingVote(nodeId: string, side: PendingVoteSide, root: HTMLElement): Promise<void> {
  if (!account || root.dataset.busy === '1') return;
  root.dataset.busy = '1';
  clearVoteRefresh();
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
  buttons.forEach(button => { button.disabled = true; });
  const status = root.querySelector<HTMLElement>('.kb-vote-status');
  if (status) status.textContent = `${side === 'AGREE' ? '赞成' : '反对'}票提交中 · 将质押 1 能量…`;
  try {
    const snapshot = await account.castPendingKnowledgeVote(nodeId, side);
    if (!root.isConnected || currentPanelNode()?.id !== nodeId) return;
    applyVoteSnapshot(root, snapshot, true);
    await refreshCachedAccount();
    if (snapshot.verdict === 'PENDING') scheduleVoteRefresh(nodeId, root, voteRenderToken);
    else await handleFinalizedVote(root, snapshot);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? `投票失败：${error.message}` : '投票失败';
    buttons.forEach(button => { button.disabled = false; });
    scheduleVoteRefresh(nodeId, root, voteRenderToken);
  } finally {
    delete root.dataset.busy;
  }
}

function applyVoteSnapshot(root: HTMLElement, snapshot: PendingKnowledgeVoteSnapshot, justVoted = false): void {
  const open = snapshot.verdict === 'PENDING';
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-vote-side]'));
  for (const button of buttons) {
    const side = button.dataset.voteSide as PendingVoteSide | undefined;
    button.classList.toggle('active', Boolean(snapshot.mySide && side === snapshot.mySide));
    button.disabled = !open || snapshot.mySide !== null;
  }
  const status = root.querySelector<HTMLElement>('.kb-vote-status');
  if (!status) return;
  const tally = `赞成 ${snapshot.agreeCount}/${snapshot.requiredVotes} · 反对 ${snapshot.disagreeCount}/${snapshot.requiredVotes}`;
  if (!open) {
    const reason = snapshot.closeReason === 'TIMEOUT' ? '时间到期' : '达到票数';
    status.textContent = `${snapshot.verdict === 'CORRECT' ? '已判定正确' : '已判定错误'} · ${reason} · ${tally}`;
    return;
  }
  const deadline = formatVoteDeadline(snapshot.deadline);
  if (snapshot.mySide) {
    status.textContent = `${justVoted ? '投票成功 · ' : ''}已投${snapshot.mySide === 'AGREE' ? '赞成' : '反对'} · ${tally}${deadline}`;
  } else {
    status.textContent = `${tally}${deadline}`;
  }
}

function formatVoteDeadline(value?: string): string {
  if (!value) return '';
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return '';
  return ` · 截止 ${time.toLocaleDateString(undefined, { month:'numeric', day:'numeric' })}`;
}

async function handleFinalizedVote(root: HTMLElement, snapshot: PendingKnowledgeVoteSnapshot): Promise<void> {
  if (root.dataset.finalized === '1') return;
  root.dataset.finalized = '1';
  clearVoteRefresh();
  await refreshCachedAccount();
  window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', {
    detail: { nodeId:snapshot.nodeId, verdict:snapshot.verdict },
  }));
}

async function sweepExpiredVoteRounds(): Promise<void> {
  if (!account || document.visibilityState === 'hidden') return;
  try {
    const processed = await account.settleExpiredPendingKnowledgeVotes(50);
    if (processed > 0) window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', { detail:{ sweep:true } }));
  } catch { /* old schema/offline clients retry on the next low-frequency sweep */ }
}

function scheduleExpirySweep(): void {
  if (!account || expirySweepTimer !== null) return;
  expirySweepTimer = window.setTimeout(async () => {
    expirySweepTimer = null;
    await sweepExpiredVoteRounds();
    scheduleExpirySweep();
  }, EXPIRY_SWEEP_MS);
}

async function refreshCachedAccount(): Promise<void> {
  if (!account) return;
  try {
    cached = await account.getAccount();
    updateAvatar();
    const overlay = document.getElementById('accountOverlay');
    if (overlay?.classList.contains('show')) openAccount(false);
  } catch { /* committed ledger state can retry independently */ }
}

function openAccount(shouldLoad = true): void {
  const overlay = document.getElementById('accountOverlay'); const body = overlay?.querySelector<HTMLElement>('.modal-body');
  if (!overlay || !body) return;
  body.innerHTML = `
    <div class="kb-profile-head"><div class="kb-profile-avatar" id="kbProfileAvatar"></div><div><strong id="kbProfileName"></strong><small id="kbProfileUsername"></small></div></div>
    <div class="kb-profile-bio" id="kbProfileBio"></div>
    <div class="account-stat"><span>我的能量</span><b id="kbMyBalance">${cached ? compactEnergy(cached.myBalance) : '—'}</b></div>
    <div class="account-stat"><span>总能量</span><b id="kbTotalEnergy">${cached ? compactEnergy(cached.totalEnergy) : '—'}</b></div>
    <div class="account-stat"><span>准确率</span><b>${cached?.accuracy ?? 0}%</b></div>
    <button class="btn primary kb-account-main-action" id="kbEditProfile" type="button">编辑资料</button>
    <div class="form-hint kb-auth-status" id="kbAccountStatus"></div>`;
  renderProfile(body, cached);
  body.querySelector('#kbEditProfile')?.addEventListener('click', () => editProfile(body));
  overlay.classList.add('show');
  if (account && shouldLoad) void loadAccount(body);
}

async function loadAccount(body?: HTMLElement): Promise<void> {
  if (!account) return;
  try { cached = await account.getAccount(); updateAvatar(); if (body) openAccount(false); }
  catch (error) { const status=body?.querySelector<HTMLElement>('#kbAccountStatus'); if(status) status.textContent=error instanceof Error?error.message:'账户读取失败'; }
}

function editProfile(body: HTMLElement): void {
  if (!account) return;
  const username=prompt('用户名（3-24 位小写字母、数字或下划线）',cached?.username??''); if(username===null)return;
  const displayName=prompt('显示名称',cached?.displayName??'')??''; const avatarUrl=prompt('头像 HTTPS 地址（可选）',cached?.avatarUrl??'')??''; const bio=prompt('个人简介（最多 280 字）',cached?.bio??'')??'';
  void account.updateProfile({username,displayName,avatarUrl,bio}).then(profile=>{cached=profile;openAccount(false);}).catch(error=>{const status=body.querySelector<HTMLElement>('#kbAccountStatus');if(status)status.textContent=error instanceof Error?error.message:'资料保存失败';});
}

function renderProfile(body:HTMLElement, profile:AccountProfile|null):void {
  const avatar=body.querySelector<HTMLElement>('#kbProfileAvatar');
  if(avatar){avatar.replaceChildren();const src=safeAvatarUrl(profile?.avatarUrl);if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(profile);},{once:true});avatar.append(image);}else avatar.textContent=initial(profile);}
  const set=(selector:string,value:string)=>{const element=body.querySelector<HTMLElement>(selector);if(element)element.textContent=value;};
  set('#kbProfileName',name(profile));set('#kbProfileUsername',`@${profile?.username??'设置用户名'}`);
  set('#kbProfileBio',profile?.bio??'匿名参与者也可以编辑知识、投票并设置公开资料。');
  set('#kbAccountStatus',account?'正在自动同步账户数据…':'远程服务未配置，本地知识功能仍可使用。');
}
function updateAvatar(): void { const avatar=document.querySelector<HTMLElement>('.avatar-btn');if(!avatar)return;avatar.replaceChildren();const src=safeAvatarUrl(cached?.avatarUrl);if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(cached);},{once:true});avatar.append(image);}else avatar.textContent=initial(cached);avatar.title='个人空间 · 匿名参与';avatar.dataset.authState='anonymous'; }
function name(profile:AccountProfile|null):string{return profile?.displayName||profile?.username||'匿名探索者';}
function initial(profile:AccountProfile|null):string{return name(profile).slice(0,1).toUpperCase();}
function installStyles():void{const style=document.createElement('style');style.textContent=`.kb-profile-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}.kb-profile-head small{display:block;color:var(--ink-faint);margin-top:3px}.kb-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--bg-deep);border:1px solid var(--brass-dim);color:var(--brass);font-weight:700}.kb-profile-avatar img,.avatar-btn img{width:100%;height:100%;object-fit:cover}.kb-profile-bio{font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:12px}.kb-account-main-action{width:100%;margin-top:10px}#panelClose{min-width:38px;min-height:38px;display:grid;place-items:center;font-size:19px}.kb-pending-vote{padding:10px;border:1px solid rgba(169,138,232,.34);border-radius:10px;background:rgba(169,138,232,.07)}.kb-vote-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}.kb-vote-heading b{font-size:12px;color:var(--ink)}.kb-vote-heading span{font-size:10px;color:#c8b9ed}.kb-vote-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.kb-vote-button{display:flex!important;flex-direction:column;align-items:center;gap:2px}.kb-vote-button span{font-size:13px}.kb-vote-button small{font-size:9px;opacity:.78}.kb-vote-button.active{box-shadow:inset 0 0 0 1px currentColor}.kb-vote-status{margin-top:7px;font-size:9.5px;line-height:1.45;color:var(--ink-faint);text-align:center}`;document.head.appendChild(style);}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
