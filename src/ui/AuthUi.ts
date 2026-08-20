import {
  compactEnergy,
  createProductionAuthClient,
  type AccountProfile,
  type PendingKnowledgeVoteSnapshot,
  type PendingVoteSide,
  type PersonalKnowledgeStateSnapshot,
  type PersonalMastery,
} from '../auth/AuthClient';
import { safeAvatarUrl } from '../auth/AuthProfilePresentation';
import { setMastery } from '../command/SetMastery';

interface DebugNode { id:string; title:string; mastery?:PersonalMastery|string; status?:string; }
interface DebugState {
  store?: Parameters<typeof setMastery>[0];
  projection?: {
    state?: { nodesById?: Record<string, DebugNode> };
    replacePersonalMastery?: (states: Readonly<Record<string, PersonalMastery>>) => void;
  };
  layoutNodes?: Array<DebugNode>;
  renderNodes?: Array<DebugNode>;
  scene?: { markDirty: () => void };
}
declare global { interface Window { __debug?: DebugState; } }

const account = createProductionAuthClient();
let cached: AccountProfile | null = null;
let markingNode = false;
let voteRenderToken = 0;
let voteRefreshTimer: number | null = null;
let expirySweepTimer: number | null = null;
let loginRequiredTimer: number | null = null;
const VOTE_REFRESH_MS = 3_000;
const EXPIRY_SWEEP_MS = 5 * 60_000;
const LOGIN_REQUIRED_MS = 2_000;
const LOCAL_PERSONAL_OWNER_KEY = 'knowledge-ball.personal-local-owner.v1';
const PERSONAL_CLOUD_MIGRATION_PREFIX = 'knowledge-ball.personal-cloud-migrated.v1:';

type AuthMode = 'login' | 'register';

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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sweepExpiredVoteRounds();
  });

  updateAvatar();
  if (account) void account.publicSession().then(async () => {
    await loadAccount();
    await syncPersonalKnowledgeCloud();
    await sweepExpiredVoteRounds();
    scheduleExpirySweep();
  }).catch(() => {
    scheduleExpirySweep();
  });
}

function currentPanelNode(): { id:string; title:string; mastery?:string; status?:string } | null {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return null;
  const title = document.getElementById('panelTitle')?.textContent?.trim();
  const nodes = window.__debug?.projection?.state?.nodesById;
  if (!title || !nodes) return null;
  return Object.values(nodes).find(candidate => candidate.title === title) ?? null;
}

function browserStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function latestLocalMastery(): Array<{ nodeId:string; mastery:PersonalMastery }> {
  const events = window.__debug?.store?.allEvents?.() ?? [];
  const latest = new Map<string, PersonalMastery>();
  for (const event of events) {
    if (event.type !== 'NodeMasterySet') continue;
    const mastery = event.payload.mastery;
    if (mastery === 'none' || mastery === 'touched' || mastery === 'mastered') {
      latest.set(event.payload.nodeId, mastery);
    }
  }
  return [...latest].map(([nodeId, mastery]) => ({ nodeId, mastery }));
}

function applyPersonalSnapshot(states: PersonalKnowledgeStateSnapshot[]): void {
  const debug = window.__debug;
  const masteryById = Object.fromEntries(states.map(state => [state.nodeId, state.mastery])) as Record<string, PersonalMastery>;

  if (debug?.projection?.replacePersonalMastery) {
    debug.projection.replacePersonalMastery(masteryById);
  } else {
    const projected = debug?.projection?.state?.nodesById;
    if (projected) {
      for (const node of Object.values(projected)) node.mastery = masteryById[node.id] ?? 'none';
    }
  }

  for (const collection of [debug?.layoutNodes, debug?.renderNodes]) {
    if (!collection) continue;
    for (const node of collection) node.mastery = masteryById[node.id] ?? 'none';
  }
  debug?.scene?.markDirty();
}

function applyOnePersonalState(state: PersonalKnowledgeStateSnapshot): void {
  const debug = window.__debug;
  const projected = debug?.projection?.state?.nodesById?.[state.nodeId];
  if (projected) projected.mastery = state.mastery;
  for (const collection of [debug?.layoutNodes, debug?.renderNodes]) {
    const node = collection?.find(candidate => candidate.id === state.nodeId);
    if (node) node.mastery = state.mastery;
  }
  debug?.scene?.markDirty();
}

async function syncPersonalKnowledgeCloud(): Promise<void> {
  if (!account) return;
  const userId = await account.currentUserId();
  const storage = browserStorage();
  let localOwner = storage?.getItem(LOCAL_PERSONAL_OWNER_KEY) ?? null;
  if (!localOwner) {
    localOwner = userId;
    try { storage?.setItem(LOCAL_PERSONAL_OWNER_KEY, userId); } catch { /* optional migration marker */ }
  }

  const migrationKey = `${PERSONAL_CLOUD_MIGRATION_PREFIX}${userId}`;
  if (localOwner === userId && storage?.getItem(migrationKey) !== '1') {
    const legacy = latestLocalMastery();
    if (legacy.length) await account.mergePersonalKnowledgeStates(legacy);
    try { storage?.setItem(migrationKey, '1'); } catch { /* idempotent server merge can safely retry */ }
  }

  const states = await account.getPersonalKnowledgeStates();
  applyPersonalSnapshot(states);
}

async function markViewedNode(): Promise<void> {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return;
  panel.querySelector<HTMLElement>('.mastery-demo-controls')?.remove();
  const privacy = panel.querySelector<HTMLElement>('.mastery-private');
  if (privacy) privacy.textContent = account
    ? 'PRIVATE ACCOUNT STATE · 查看即自动点亮，并同步到你的唯一账户'
    : 'LOCAL ONLY · 远程账户未配置，仅保存在当前设备';
  const node = currentPanelNode();
  const debug = window.__debug;
  if (!node || markingNode || node.mastery !== 'none') return;
  markingNode = true;
  try {
    if (account) {
      const state = await account.markKnowledgeTouched(node.id);
      applyOnePersonalState(state);
    } else if (debug?.store) {
      await setMastery(debug.store, { nodeId:node.id, mastery:'touched' });
    }
  } finally { markingNode = false; }
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
    if (processed > 0) {
      window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', { detail:{ sweep:true } }));
    }
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
  const overlay = document.getElementById('accountOverlay');
  const body = overlay?.querySelector<HTMLElement>('.modal-body');
  if (!overlay || !body) return;
  body.innerHTML = `
    <div class="kb-profile-head"><div class="kb-profile-avatar" id="kbProfileAvatar"></div><div><strong id="kbProfileName"></strong><small id="kbProfileUsername"></small></div></div>
    <div class="kb-profile-bio" id="kbProfileBio"></div>
    <div class="account-stat"><span>我的能量</span><b id="kbMyBalance">${cached ? compactEnergy(cached.myBalance) : '—'}</b></div>
    <div class="account-stat"><span>总能量</span><b id="kbTotalEnergy">${cached ? compactEnergy(cached.totalEnergy) : '—'}</b></div>
    <div class="account-stat"><span>准确率</span><b>${cached?.accuracy ?? 0}%</b></div>
    <button class="btn primary kb-account-main-action" id="kbAuthEntry" type="button">注册 / 登录</button>
    <button class="btn ghost kb-account-main-action" id="kbEditProfile" type="button">修改资料</button>
    <div class="form-hint kb-auth-status" id="kbAccountStatus"></div>`;
  renderProfile(body, cached);
  body.querySelector('#kbAuthEntry')?.addEventListener('click', () => renderAuthForm(body, 'login'));
  body.querySelector('#kbEditProfile')?.addEventListener('click', () => editProfile(body));
  overlay.classList.add('show');
  if (account && shouldLoad) void loadAccount(body);
}

async function loadAccount(body?: HTMLElement): Promise<void> {
  if (!account) return;
  try {
    cached = await account.getAccount();
    updateAvatar();
    if (body) openAccount(false);
  } catch (error) {
    const status = body?.querySelector<HTMLElement>('#kbAccountStatus');
    if (status) status.textContent = error instanceof Error ? error.message : '账户读取失败';
  }
}

function accountStatus(body: HTMLElement, value: string): void {
  const status = body.querySelector<HTMLElement>('#kbAccountStatus');
  if (status) status.textContent = value;
}

function renderAuthForm(body: HTMLElement, mode: AuthMode = 'login'): void {
  const registering = mode === 'register';
  const suggestedUsername = cached?.username?.startsWith('guest_') ? '' : cached?.username ?? '';
  body.innerHTML = `
    <section class="kb-auth-card" aria-label="账户注册登录">
      <div class="kb-auth-tabs" role="tablist" aria-label="注册或登录">
        <button class="kb-auth-tab ${!registering ? 'active' : ''}" type="button" data-auth-mode="login" role="tab" aria-selected="${!registering}">登录</button>
        <button class="kb-auth-tab ${registering ? 'active' : ''}" type="button" data-auth-mode="register" role="tab" aria-selected="${registering}">注册</button>
      </div>
      <form class="kb-auth-form" id="kbAuthForm" novalidate>
        <label>用户名
          <input name="username" type="text" inputmode="text" autocomplete="username" minlength="3" maxlength="24" pattern="[a-z0-9_]{3,24}" value="${escapeHtml(registering ? suggestedUsername : '')}" placeholder="3-24 位小写字母、数字或下划线" required>
        </label>
        <label>密码
          <input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" maxlength="256" placeholder="请输入密码" required>
        </label>
        ${registering ? `<label>确认密码
          <input name="passwordConfirm" type="password" autocomplete="new-password" maxlength="256" placeholder="再次输入密码" required>
        </label>` : ''}
        <button class="btn primary kb-auth-submit" type="submit">${registering ? '注册' : '登录'}</button>
      </form>
      <button class="btn ghost kb-auth-back" id="kbAuthBack" type="button">返回账户</button>
      <div class="form-hint kb-auth-status" id="kbAccountStatus">${registering ? '注册后即可修改个人资料，并可在其他浏览器登录同一账户。' : '使用已经注册的用户名和密码登录。'}</div>
    </section>`;

  for (const tab of body.querySelectorAll<HTMLButtonElement>('[data-auth-mode]')) {
    tab.addEventListener('click', () => renderAuthForm(body, tab.dataset.authMode === 'register' ? 'register' : 'login'));
  }
  body.querySelector('#kbAuthBack')?.addEventListener('click', () => openAccount(false));
  body.querySelector<HTMLFormElement>('#kbAuthForm')?.addEventListener('submit', event => {
    event.preventDefault();
    void submitAuthForm(body, mode, event.currentTarget as HTMLFormElement);
  });
}

async function submitAuthForm(body: HTMLElement, mode: AuthMode, form: HTMLFormElement): Promise<void> {
  if (!account) return;
  const username = formValue(form, 'username').trim().toLowerCase();
  const password = formValue(form, 'password');
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    accountStatus(body, '用户名必须是 3-24 位小写字母、数字或下划线');
    return;
  }
  if (!password) {
    accountStatus(body, '请输入密码');
    return;
  }
  if (mode === 'register' && password !== formValue(form, 'passwordConfirm')) {
    accountStatus(body, '两次输入的密码不一致');
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>('.kb-auth-submit');
  if (submit) submit.disabled = true;
  accountStatus(body, mode === 'register' ? '正在注册账户…' : '正在登录…');

  try {
    cached = mode === 'register'
      ? await account.claimUsernamePassword(username, password)
      : await account.loginUsernamePassword(username, password);
    await syncPersonalKnowledgeCloud();
    updateAvatar();
    openAccount(false);
    const nextBody = document.getElementById('accountOverlay')?.querySelector<HTMLElement>('.modal-body');
    if (nextBody) accountStatus(nextBody, mode === 'register' ? '注册成功' : '登录成功');
  } catch (error) {
    accountStatus(body, error instanceof Error ? error.message : mode === 'register' ? '注册失败' : '用户名或密码错误');
    if (submit) submit.disabled = false;
  }
}

function formValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : '';
}

function editProfile(body: HTMLElement): void {
  if (!account) return;
  if (!cached?.passwordLoginEnabled) {
    flashLoginRequired();
    return;
  }
  renderProfileEditForm(body);
}

function renderProfileEditForm(body: HTMLElement): void {
  if (!cached) return;
  body.innerHTML = `
    <section class="kb-auth-card" aria-label="修改个人资料">
      <h3 class="kb-profile-edit-title">修改资料</h3>
      <form class="kb-auth-form kb-profile-edit-form" id="kbProfileEditForm" novalidate>
        <label>用户名
          <input name="username" type="text" inputmode="text" autocomplete="username" minlength="3" maxlength="24" pattern="[a-z0-9_]{3,24}" value="${escapeHtml(cached.username ?? '')}" placeholder="3-24 位小写字母、数字或下划线" required>
        </label>
        <label>显示名称
          <input name="displayName" type="text" maxlength="60" value="${escapeHtml(cached.displayName ?? '')}" placeholder="公开显示的名称">
        </label>
        <label>头像地址
          <input name="avatarUrl" type="url" inputmode="url" maxlength="2048" value="${escapeHtml(cached.avatarUrl ?? '')}" placeholder="https://…（可选）">
        </label>
        <label>个人简介
          <textarea name="bio" maxlength="280" placeholder="最多 280 字">${escapeHtml(cached.bio ?? '')}</textarea>
        </label>
        <button class="btn primary kb-auth-submit" type="submit">保存资料</button>
      </form>
      <button class="btn ghost kb-auth-back" id="kbProfileEditBack" type="button">取消</button>
      <div class="form-hint kb-auth-status" id="kbAccountStatus">一次填写并保存全部资料。</div>
    </section>`;

  body.querySelector('#kbProfileEditBack')?.addEventListener('click', () => openAccount(false));
  body.querySelector<HTMLFormElement>('#kbProfileEditForm')?.addEventListener('submit', event => {
    event.preventDefault();
    void submitProfileEditForm(body, event.currentTarget as HTMLFormElement);
  });
}

async function submitProfileEditForm(body: HTMLElement, form: HTMLFormElement): Promise<void> {
  if (!account || !cached?.passwordLoginEnabled) {
    flashLoginRequired();
    return;
  }
  const username = formValue(form, 'username').trim().toLowerCase();
  const displayName = formValue(form, 'displayName').trim();
  const avatarUrl = formValue(form, 'avatarUrl').trim();
  const bio = formValue(form, 'bio').trim();

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    accountStatus(body, '用户名必须是 3-24 位小写字母、数字或下划线');
    return;
  }
  if (displayName.length > 60) {
    accountStatus(body, '显示名称最多 60 字');
    return;
  }
  if (avatarUrl && !safeAvatarUrl(avatarUrl)) {
    accountStatus(body, '头像地址必须是 HTTPS 链接');
    return;
  }
  if (bio.length > 280) {
    accountStatus(body, '个人简介最多 280 字');
    return;
  }

  const submit = form.querySelector<HTMLButtonElement>('.kb-auth-submit');
  if (submit) submit.disabled = true;
  accountStatus(body, '正在保存资料…');
  try {
    cached = await account.updateProfile({ username, displayName, avatarUrl, bio });
    updateAvatar();
    openAccount(false);
    const nextBody = document.getElementById('accountOverlay')?.querySelector<HTMLElement>('.modal-body');
    if (nextBody) accountStatus(nextBody, '资料已保存');
  } catch (error) {
    accountStatus(body, error instanceof Error ? error.message : '资料保存失败');
    if (submit) submit.disabled = false;
  }
}

function flashLoginRequired(): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (loginRequiredTimer !== null) window.clearTimeout(loginRequiredTimer);
  toast.textContent = '请先登录账户';
  toast.classList.add('show');
  loginRequiredTimer = window.setTimeout(() => {
    toast.classList.remove('show');
    loginRequiredTimer = null;
  }, LOGIN_REQUIRED_MS);
}

function renderProfile(body:HTMLElement, profile:AccountProfile|null):void {
  const avatar=body.querySelector<HTMLElement>('#kbProfileAvatar');
  if(avatar){avatar.replaceChildren();const src=safeAvatarUrl(profile?.avatarUrl);if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(profile);},{once:true});avatar.append(image);}else avatar.textContent=initial(profile);}
  const set=(selector:string,value:string)=>{const element=body.querySelector<HTMLElement>(selector);if(element)element.textContent=value;};
  set('#kbProfileName',name(profile));set('#kbProfileUsername',`@${profile?.username??'游客'}`);
  set('#kbProfileBio',profile?.bio??'个人资料、账户和知识节点掌握状态均绑定到唯一 user_id。');
  set('#kbAccountStatus',account
    ? profile?.passwordLoginEnabled ? '已登录账户' : '游客模式 · 修改资料前请先注册或登录'
    : '远程服务未配置；个人状态只能留在当前设备。');
}

function updateAvatar(): void {
  const avatar=document.querySelector<HTMLElement>('.avatar-btn');if(!avatar)return;
  avatar.replaceChildren();
  const src=safeAvatarUrl(cached?.avatarUrl);
  if(src){const image=document.createElement('img');image.src=src;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();avatar.textContent=initial(cached);},{once:true});avatar.append(image);}else avatar.textContent=initial(cached);
  avatar.title='个人空间 · 账户与知识记录';
  avatar.dataset.authState=cached?.passwordLoginEnabled?'registered':'guest';
}
function name(profile:AccountProfile|null):string{return profile?.displayName||profile?.username||'匿名探索者';}
function initial(profile:AccountProfile|null):string{return name(profile).slice(0,1).toUpperCase();}
function escapeHtml(value:string):string{return value.replace(/[&<>'"]/g,char=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]??char));}
function installStyles():void{const style=document.createElement('style');style.textContent=`.kb-profile-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}.kb-profile-head small{display:block;color:var(--ink-faint);margin-top:3px}.kb-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:var(--bg-deep);border:1px solid var(--brass-dim);color:var(--brass);font-weight:700}.kb-profile-avatar img,.avatar-btn img{width:100%;height:100%;object-fit:cover}.kb-profile-bio{font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:12px}.kb-account-main-action{width:100%;margin-top:8px}.kb-auth-card{width:100%}.kb-auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--bg-deep);border:1px solid var(--panel-border);border-radius:9px;margin-bottom:18px}.kb-auth-tab{appearance:none;border:0;border-radius:6px;padding:9px;background:transparent;color:var(--ink-faint);font:600 13px inherit;cursor:pointer}.kb-auth-tab.active{background:var(--panel);color:var(--ink);box-shadow:0 1px 8px rgba(0,0,0,.3)}.kb-auth-form{display:flex;flex-direction:column;gap:13px}.kb-auth-form label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--ink-dim)}.kb-auth-form input,.kb-auth-form textarea{width:100%;background:var(--bg-deep);border:1px solid var(--panel-border);color:var(--ink);padding:11px 12px;border-radius:7px;font:13px inherit;outline:none}.kb-auth-form input:focus,.kb-auth-form textarea:focus{border-color:var(--brass-dim)}.kb-profile-edit-title{margin:0 0 16px;font-size:16px;color:var(--ink)}.kb-profile-edit-form textarea{min-height:88px;resize:vertical}.kb-auth-submit{width:100%;margin-top:4px;padding:10px 12px}.kb-auth-back{width:100%;margin-top:8px}.kb-auth-status{margin-top:10px;min-height:18px;text-align:center}#panelClose{min-width:38px;min-height:38px;display:grid;place-items:center;font-size:19px}.kb-pending-vote{padding:10px;border:1px solid rgba(169,138,232,.34);border-radius:10px;background:rgba(169,138,232,.07)}.kb-vote-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}.kb-vote-heading b{font-size:12px;color:var(--ink)}.kb-vote-heading span{font-size:10px;color:#c8b9ed}.kb-vote-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.kb-vote-button{display:flex!important;flex-direction:column;align-items:center;gap:2px}.kb-vote-button span{font-size:13px}.kb-vote-button small{font-size:9px;opacity:.78}.kb-vote-button.active{box-shadow:inset 0 0 0 1px currentColor}.kb-vote-status{margin-top:7px;font-size:9.5px;line-height:1.45;color:var(--ink-faint);text-align:center}`;document.head.appendChild(style);}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();