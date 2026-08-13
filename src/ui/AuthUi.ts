import { compactEnergy, createProductionAuthClient, type AccountProfile } from '../auth/AuthClient';
import { setMastery } from '../command/SetMastery';

const WRITE_ENTRY_IDS = new Set([
  'aiAddBtn',
  'btnEditNode',
  'btnDeriveNode',
  'btnDecompose',
  'btnMerge',
  'btnNegate',
  'btnResolve',
  'btnDispute',
  'modalSubmit',
]);

interface DebugState {
  store?: Parameters<typeof setMastery>[0];
  projection?: {
    state?: {
      nodesById?: Record<string, { id: string; title: string; mastery?: string }>;
    };
  };
  syncEngine?: { sync(): Promise<void> } | null;
}

declare global {
  interface Window { __debug?: DebugState; }
}

const auth = createProductionAuthClient();
let authOverlay: HTMLElement | null = null;
let authMode: 'login' | 'register' = 'login';
let pendingPhone = '';
let accountCache: AccountProfile | null = null;
let markingNode = false;

function start(): void {
  installStyles();
  installAuthOverlay();
  document.addEventListener('click', captureProtectedActions, true);
  const panel = document.getElementById('panel');
  if (panel) new MutationObserver(() => void normalizeNodePanel()).observe(panel, { subtree: true, childList: true, attributes: true });
  updateAvatarState();
}

function captureProtectedActions(event: Event): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,.avatar-btn') : null;
  if (!target) return;

  if (target.matches('.avatar-btn') || target.id === 'avatarBtn') {
    event.preventDefault();
    event.stopImmediatePropagation();
    openAccount();
    return;
  }

  if (!WRITE_ENTRY_IDS.has(target.id)) return;
  if (auth?.hasVerifiedIdentity()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openAuth('提交公共知识前需要注册或登录。浏览和本地点亮始终无需账户。');
}

async function normalizeNodePanel(): Promise<void> {
  const panel = document.getElementById('panel');
  if (!panel?.classList.contains('open')) return;
  panel.querySelector<HTMLElement>('.mastery-demo-controls')?.remove();
  const privacy = panel.querySelector<HTMLElement>('.mastery-private');
  if (privacy) privacy.textContent = 'LOCAL ONLY · 查看即自动点亮，只保存在当前设备';

  const title = document.getElementById('panelTitle')?.textContent?.trim();
  const debug = window.__debug;
  const nodes = debug?.projection?.state?.nodesById;
  if (!title || !nodes || !debug?.store || markingNode) return;
  const node = Object.values(nodes).find(candidate => candidate.title === title);
  if (!node || node.mastery !== 'none') return;
  markingNode = true;
  try {
    await setMastery(debug.store, { nodeId: node.id, mastery: 'touched' });
  } catch (error) {
    console.warn('[Knowledge-Ball] local view highlight failed:', error);
  } finally {
    markingNode = false;
  }
}

function installAuthOverlay(): void {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'kbAuthOverlay';
  overlay.innerHTML = `
    <div class="modal kb-auth-modal" role="dialog" aria-modal="true" aria-labelledby="kbAuthTitle">
      <div class="modal-header">
        <div><h3 id="kbAuthTitle">登录或注册</h3><div class="kb-auth-subtitle">游客可浏览全部公共知识；写入公共知识需要手机号账户。</div></div>
        <button class="panel-close" id="kbAuthClose" type="button">✕</button>
      </div>
      <div class="modal-body">
        <div class="kb-auth-tabs">
          <button class="btn active" id="kbLoginTab" type="button">登录</button>
          <button class="btn" id="kbRegisterTab" type="button">注册</button>
        </div>
        <div class="form-hint" id="kbAuthReason"></div>
        <div class="form-field"><label>手机号</label><input type="tel" id="kbPhone" autocomplete="tel" placeholder="+8613812345678"></div>
        <div class="form-field"><label>密码</label><input type="password" id="kbPassword" autocomplete="current-password" placeholder="至少 8 位"></div>
        <div id="kbOtpWrap" hidden>
          <div class="form-field"><label>短信验证码</label><input type="text" id="kbOtp" inputmode="numeric" autocomplete="one-time-code" placeholder="6 位验证码"></div>
        </div>
        <div class="form-hint kb-auth-status" id="kbAuthStatus" role="status" aria-live="polite"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="kbAuthCancel" type="button">取消</button>
        <button class="btn primary" id="kbAuthSubmit" type="button">登录</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  authOverlay = overlay;

  overlay.querySelector('#kbAuthClose')?.addEventListener('click', closeAuth);
  overlay.querySelector('#kbAuthCancel')?.addEventListener('click', closeAuth);
  overlay.addEventListener('click', event => { if (event.target === overlay) closeAuth(); });
  overlay.querySelector('#kbLoginTab')?.addEventListener('click', () => setAuthMode('login'));
  overlay.querySelector('#kbRegisterTab')?.addEventListener('click', () => setAuthMode('register'));
  overlay.querySelector('#kbAuthSubmit')?.addEventListener('click', () => void submitAuth());
}

function openAuth(reason = ''): void {
  if (!authOverlay) return;
  const reasonEl = authOverlay.querySelector<HTMLElement>('#kbAuthReason');
  if (reasonEl) reasonEl.textContent = reason;
  setAuthMode('login');
  authOverlay.classList.add('show');
  authOverlay.querySelector<HTMLInputElement>('#kbPhone')?.focus();
}

function closeAuth(): void {
  authOverlay?.classList.remove('show');
  setStatus('');
}

function setAuthMode(mode: 'login' | 'register'): void {
  authMode = mode;
  pendingPhone = '';
  const login = authOverlay?.querySelector<HTMLButtonElement>('#kbLoginTab');
  const register = authOverlay?.querySelector<HTMLButtonElement>('#kbRegisterTab');
  const submit = authOverlay?.querySelector<HTMLButtonElement>('#kbAuthSubmit');
  const password = authOverlay?.querySelector<HTMLInputElement>('#kbPassword');
  const otpWrap = authOverlay?.querySelector<HTMLElement>('#kbOtpWrap');
  login?.classList.toggle('active', mode === 'login');
  register?.classList.toggle('active', mode === 'register');
  if (submit) submit.textContent = mode === 'login' ? '登录' : '注册';
  if (password) password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  if (otpWrap) otpWrap.hidden = true;
  setStatus('');
}

async function submitAuth(): Promise<void> {
  if (!auth || !auth.isConfigured()) {
    setStatus('远程账户服务尚未配置。', true);
    return;
  }
  const phone = authOverlay?.querySelector<HTMLInputElement>('#kbPhone')?.value ?? '';
  const password = authOverlay?.querySelector<HTMLInputElement>('#kbPassword')?.value ?? '';
  const otp = authOverlay?.querySelector<HTMLInputElement>('#kbOtp')?.value ?? '';
  const otpWrap = authOverlay?.querySelector<HTMLElement>('#kbOtpWrap');
  const submit = authOverlay?.querySelector<HTMLButtonElement>('#kbAuthSubmit');
  if (password.length < 8 && otpWrap?.hidden !== false) {
    setStatus('密码至少 8 位。', true);
    return;
  }
  if (submit) submit.disabled = true;
  try {
    if (otpWrap?.hidden === false) {
      await auth.verifySms(pendingPhone || phone, otp);
      onAuthenticated('注册完成');
      return;
    }
    if (authMode === 'login') {
      await auth.signIn(phone, password);
      onAuthenticated('登录成功');
      return;
    }
    const result = await auth.signUp(phone, password);
    if (result.verificationRequired) {
      pendingPhone = phone;
      otpWrap!.hidden = false;
      if (submit) submit.textContent = '验证并完成注册';
      setStatus('验证码已发送，请输入短信验证码。');
      authOverlay?.querySelector<HTMLInputElement>('#kbOtp')?.focus();
      return;
    }
    onAuthenticated('注册完成');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '认证失败', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function onAuthenticated(message: string): void {
  closeAuth();
  updateAvatarState();
  showToast(message);
  void loadAccount();
  void window.__debug?.syncEngine?.sync().catch(error => console.warn('[Knowledge-Ball] post-login sync failed:', error));
}

function openAccount(): void {
  const overlay = document.getElementById('accountOverlay');
  if (!overlay) return;
  const title = overlay.querySelector<HTMLElement>('.modal-header h3');
  const body = overlay.querySelector<HTMLElement>('.modal-body');
  if (!body) return;
  if (title) title.textContent = auth?.hasVerifiedIdentity() ? '个人账户' : '游客';

  if (!auth?.hasVerifiedIdentity()) {
    body.innerHTML = `
      <div class="kb-account-guest">无需登录即可查看全部公共知识；查看过的节点会自动点亮，并且只保存在当前设备。</div>
      <button class="btn primary kb-account-main-action" id="kbAccountLogin" type="button">注册 / 登录</button>`;
    body.querySelector('#kbAccountLogin')?.addEventListener('click', () => {
      overlay.classList.remove('show');
      openAuth('注册或登录后才能新增、修改、否定、分解、合并知识节点。');
    });
  } else {
    body.innerHTML = `
      <div class="kb-profile-head"><div class="kb-profile-avatar" id="kbProfileAvatar">${profileInitial(accountCache)}</div><div><strong id="kbProfileName">${profileName(accountCache)}</strong><small>@${accountCache?.username ?? '设置用户名'}</small></div></div>
      <div class="kb-profile-bio" id="kbProfileBio">${accountCache?.bio ?? '还没有个人简介'}</div>
      <div class="account-stat"><span>我的能量</span><b id="kbMyBalance">${accountCache ? compactEnergy(accountCache.myBalance) : '—'}</b></div>
      <div class="account-stat"><span>总能量</span><b id="kbTotalEnergy">${accountCache ? compactEnergy(accountCache.totalEnergy) : '—'}</b></div>
      <div class="account-stat"><span>准确率</span><b>${accountCache?.accuracy ?? 0}%</b></div>
      <button class="btn primary kb-account-main-action" id="kbEditProfile" type="button">编辑资料</button>
      <button class="btn ghost kb-account-main-action" id="kbLogout" type="button">退出登录</button>
      <div class="form-hint kb-auth-status" id="kbBalanceStatus">正在加载账户资料…</div>`;
    body.querySelector('#kbEditProfile')?.addEventListener('click', () => editProfile(body));
    body.querySelector('#kbLogout')?.addEventListener('click', () => void logout(overlay));
    void loadAccount(body);
  }
  overlay.classList.add('show');
}

async function loadAccount(body?: HTMLElement): Promise<void> {
  const status = body?.querySelector<HTMLElement>('#kbBalanceStatus');
  if (!auth) return;
  if (status) status.textContent = '正在读取最新余额…';
  try {
    accountCache = await auth.getAccount();
    const mine = body?.querySelector<HTMLElement>('#kbMyBalance');
    const total = body?.querySelector<HTMLElement>('#kbTotalEnergy');
    if (mine) mine.textContent = compactEnergy(accountCache.myBalance);
    if (total) total.textContent = compactEnergy(accountCache.totalEnergy);
    if (status) status.textContent = '';
    updateAvatarState();
    if (body) {
      const name = body.querySelector<HTMLElement>('#kbProfileName');
      const bio = body.querySelector<HTMLElement>('#kbProfileBio');
      const profileAvatar = body.querySelector<HTMLElement>('#kbProfileAvatar');
      if (name) name.textContent = profileName(accountCache);
      if (bio) bio.textContent = accountCache.bio ?? '还没有个人简介';
      if (profileAvatar) applyAvatar(profileAvatar, accountCache);
    }
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : '余额读取失败';
  }
}

function editProfile(body: HTMLElement): void {
  const username = prompt('用户名（3-24 位小写字母、数字或下划线）', accountCache?.username ?? '');
  if (username === null || !auth) return;
  const displayName = prompt('显示名称', accountCache?.displayName ?? '') ?? '';
  const avatarUrl = prompt('头像 HTTPS 地址（可选）', accountCache?.avatarUrl ?? '') ?? '';
  const bio = prompt('个人简介（最多 280 字）', accountCache?.bio ?? '') ?? '';
  void auth.updateProfile({ username, displayName, avatarUrl, bio }).then(profile => {
    accountCache = profile;
    openAccount();
    showToast('资料已保存');
  }).catch(error => {
    const status = body.querySelector<HTMLElement>('#kbBalanceStatus');
    if (status) status.textContent = error instanceof Error ? error.message : '资料保存失败';
  });
}

async function logout(overlay: HTMLElement): Promise<void> {
  await auth?.signOut();
  accountCache = null;
  overlay.classList.remove('show');
  updateAvatarState();
  showToast('已退出登录，仍可继续浏览公共知识。');
}

function updateAvatarState(): void {
  const avatar = document.querySelector<HTMLElement>('.avatar-btn');
  if (!avatar) return;
  const loggedIn = auth?.hasVerifiedIdentity() ?? false;
  avatar.textContent = loggedIn ? profileInitial(accountCache) : '访';
  applyAvatar(avatar, loggedIn ? accountCache : null);
  avatar.title = loggedIn ? '个人账户' : '游客 · 点击登录或注册';
  avatar.dataset.authState = loggedIn ? 'authenticated' : 'guest';
}

function profileName(profile: AccountProfile | null): string { return profile?.displayName || profile?.username || '知识探索者'; }
function profileInitial(profile: AccountProfile | null): string { return profileName(profile).slice(0, 1).toUpperCase(); }
function applyAvatar(element: HTMLElement, profile: AccountProfile | null): void {
  element.style.backgroundImage = profile?.avatarUrl ? `url("${profile.avatarUrl.replace(/["\\]/g, '')}")` : '';
  element.style.backgroundSize = 'cover';
  element.style.backgroundPosition = 'center';
  element.textContent = profile?.avatarUrl ? '' : profileInitial(profile);
}

function setStatus(message: string, isError = false): void {
  const el = authOverlay?.querySelector<HTMLElement>('#kbAuthStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.error = isError ? 'true' : 'false';
}

function showToast(message: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function installStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    .kb-auth-modal{max-width:420px}
    .kb-auth-subtitle{font-size:11px;color:var(--ink-faint);margin-top:4px;line-height:1.45}
    .kb-auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
    .kb-auth-tabs .btn{width:100%}
    .kb-auth-status{margin-top:8px;min-height:18px}
    .kb-auth-status[data-error="true"]{color:#E8918E}
    .kb-account-guest{font-size:13px;line-height:1.7;color:var(--ink-dim);padding:4px 0 14px}
    .kb-account-main-action{width:100%;margin-top:10px}
    .kb-profile-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}.kb-profile-head small{display:block;color:var(--ink-faint);margin-top:3px}
    .kb-profile-avatar{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--bg-deep);border:1px solid var(--brass-dim);color:var(--brass);font-weight:700}
    .kb-profile-bio{font-size:12px;color:var(--ink-dim);line-height:1.6;margin-bottom:12px}
    .avatar-btn[data-auth-state="guest"]{border-style:dashed;color:var(--ink-dim)}
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
