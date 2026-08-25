import {
  compactEnergy,
  createProductionAuthClient,
  type AccountProfile,
  type PersonalKnowledgeStateSnapshot,
  type PersonalMastery,
} from '../auth/AuthClient';
import { safeAvatarUrl } from '../auth/AuthProfilePresentation';
import './AccountUi.css';

const EXPIRY_SWEEP_MS = 5 * 60_000;
const LOGIN_REQUIRED_MS = 2_000;
const LOCAL_PERSONAL_OWNER_KEY = 'knowledge-ball.personal-local-owner.v1';
const PERSONAL_CLOUD_MIGRATION_PREFIX = 'knowledge-ball.personal-cloud-migrated.v1:';

type AuthMode = 'login' | 'register';

export interface AccountUiOptions {
  avatarButton: HTMLElement | null;
  accountOverlay: HTMLElement | null;
  accountClose: HTMLElement | null;
  toast: HTMLElement | null;
  getLocalPersonalStates: () => Array<{ nodeId: string; mastery: PersonalMastery }>;
  applyPersonalSnapshot: (states: PersonalKnowledgeStateSnapshot[]) => void;
  onIdentityResolved?: (userId: string) => void;
}

export class AccountUiController {
  private readonly account = createProductionAuthClient();
  private cached: AccountProfile | null = null;
  private expirySweepTimer: number | null = null;
  private loginRequiredTimer: number | null = null;

  constructor(private readonly options: AccountUiOptions) {
    if (this.options.accountClose instanceof HTMLButtonElement) this.options.accountClose.type = 'button';
    this.options.accountClose?.setAttribute('aria-label', '返回知识球');
    this.options.accountClose?.setAttribute('title', '返回知识球');
    this.options.avatarButton?.addEventListener('click', this.handleAvatarClick);
    this.options.accountClose?.addEventListener('click', this.close);
    this.options.accountOverlay?.addEventListener('click', this.handleOverlayClick);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    this.updateAvatar();
    if (this.account) {
      void this.account.publicSession().then(async () => {
        await this.loadAccount();
        await this.syncPersonalKnowledgeCloud();
        await this.sweepExpiredVoteRounds();
        this.scheduleExpirySweep();
      }).catch(() => {
        this.scheduleExpirySweep();
      });
    }
  }

  destroy(): void {
    this.options.avatarButton?.removeEventListener('click', this.handleAvatarClick);
    this.options.accountClose?.removeEventListener('click', this.close);
    this.options.accountOverlay?.removeEventListener('click', this.handleOverlayClick);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.expirySweepTimer !== null) window.clearTimeout(this.expirySweepTimer);
    if (this.loginRequiredTimer !== null) window.clearTimeout(this.loginRequiredTimer);
    this.expirySweepTimer = null;
    this.loginRequiredTimer = null;
  }

  open = (shouldLoad = true): void => {
    const overlay = this.options.accountOverlay;
    const body = overlay?.querySelector<HTMLElement>('.modal-body');
    if (!overlay || !body) return;
    body.innerHTML = `
      <div class="kb-profile-head"><div class="kb-profile-avatar" id="kbProfileAvatar"></div><div><strong id="kbProfileName"></strong><small id="kbProfileUsername"></small></div></div>
      <div class="kb-profile-bio" id="kbProfileBio"></div>
      <div class="account-stat"><span>我的能量</span><b id="kbMyBalance">${this.cached ? compactEnergy(this.cached.myBalance) : '—'}</b></div>
      <div class="account-stat"><span>总能量</span><b id="kbTotalEnergy">${this.cached ? compactEnergy(this.cached.totalEnergy) : '—'}</b></div>
      <div class="account-stat"><span>准确率</span><b>${this.cached?.accuracy ?? 0}%</b></div>
      <button class="btn primary kb-account-main-action" id="kbAuthEntry" type="button">注册 / 登录</button>
      <button class="btn ghost kb-account-main-action" id="kbEditProfile" type="button">修改资料</button>
      <div class="form-hint kb-auth-status" id="kbAccountStatus"></div>`;
    this.renderProfile(body, this.cached);
    body.querySelector('#kbAuthEntry')?.addEventListener('click', () => this.renderAuthForm(body, 'login'));
    body.querySelector('#kbEditProfile')?.addEventListener('click', () => this.editProfile(body));
    overlay.classList.add('show');
    if (this.account && shouldLoad) void this.loadAccount(body);
  };

  close = (): void => {
    this.options.accountOverlay?.classList.remove('show');
  };

  private readonly handleAvatarClick = () => this.open();
  private readonly handleOverlayClick = (event: MouseEvent) => {
    if (event.target === this.options.accountOverlay) this.close();
  };
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') void this.sweepExpiredVoteRounds();
  };

  private browserStorage(): Storage | null {
    try { return window.localStorage; } catch { return null; }
  }

  private async syncPersonalKnowledgeCloud(): Promise<void> {
    if (!this.account) return;
    const userId = await this.account.currentUserId();
    this.options.onIdentityResolved?.(userId);
    const storage = this.browserStorage();
    let localOwner = storage?.getItem(LOCAL_PERSONAL_OWNER_KEY) ?? null;
    if (!localOwner) {
      localOwner = userId;
      try { storage?.setItem(LOCAL_PERSONAL_OWNER_KEY, userId); } catch { /* optional migration marker */ }
    }

    const migrationKey = `${PERSONAL_CLOUD_MIGRATION_PREFIX}${userId}`;
    if (localOwner === userId && storage?.getItem(migrationKey) !== '1') {
      const legacy = this.options.getLocalPersonalStates();
      if (legacy.length) await this.account.mergePersonalKnowledgeStates(legacy);
      try { storage?.setItem(migrationKey, '1'); } catch { /* server merge is idempotent */ }
    }

    const states = await this.account.getPersonalKnowledgeStates();
    this.options.applyPersonalSnapshot(states);
  }

  private async loadAccount(body?: HTMLElement): Promise<void> {
    if (!this.account) return;
    try {
      this.cached = await this.account.getAccount();
      this.updateAvatar();
      if (body) this.open(false);
    } catch (error) {
      const status = body?.querySelector<HTMLElement>('#kbAccountStatus');
      if (status) status.textContent = error instanceof Error ? error.message : '账户读取失败';
    }
  }

  private accountStatus(body: HTMLElement, value: string): void {
    const status = body.querySelector<HTMLElement>('#kbAccountStatus');
    if (status) status.textContent = value;
  }

  private renderAuthForm(body: HTMLElement, mode: AuthMode = 'login'): void {
    const registering = mode === 'register';
    const suggestedUsername = this.cached?.username?.startsWith('guest_') ? '' : this.cached?.username ?? '';
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
      tab.addEventListener('click', () => this.renderAuthForm(body, tab.dataset.authMode === 'register' ? 'register' : 'login'));
    }
    body.querySelector('#kbAuthBack')?.addEventListener('click', () => this.open(false));
    body.querySelector<HTMLFormElement>('#kbAuthForm')?.addEventListener('submit', event => {
      event.preventDefault();
      void this.submitAuthForm(body, mode, event.currentTarget as HTMLFormElement);
    });
  }

  private async submitAuthForm(body: HTMLElement, mode: AuthMode, form: HTMLFormElement): Promise<void> {
    if (!this.account) return;
    const username = formValue(form, 'username').trim().toLowerCase();
    const password = formValue(form, 'password');
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      this.accountStatus(body, '用户名必须是 3-24 位小写字母、数字或下划线');
      return;
    }
    if (!password) {
      this.accountStatus(body, '请输入密码');
      return;
    }
    if (mode === 'register' && password !== formValue(form, 'passwordConfirm')) {
      this.accountStatus(body, '两次输入的密码不一致');
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>('.kb-auth-submit');
    if (submit) submit.disabled = true;
    this.accountStatus(body, mode === 'register' ? '正在注册账户…' : '正在登录…');

    try {
      this.cached = mode === 'register'
        ? await this.account.claimUsernamePassword(username, password)
        : await this.account.loginUsernamePassword(username, password);
      await this.syncPersonalKnowledgeCloud();
      this.updateAvatar();
      this.open(false);
      const nextBody = this.options.accountOverlay?.querySelector<HTMLElement>('.modal-body');
      if (nextBody) this.accountStatus(nextBody, mode === 'register' ? '注册成功' : '登录成功');
    } catch (error) {
      this.accountStatus(body, error instanceof Error ? error.message : mode === 'register' ? '注册失败' : '用户名或密码错误');
      if (submit) submit.disabled = false;
    }
  }

  private editProfile(body: HTMLElement): void {
    if (!this.account) return;
    if (!this.cached?.passwordLoginEnabled) {
      this.flashLoginRequired();
      return;
    }
    this.renderProfileEditForm(body);
  }

  private renderProfileEditForm(body: HTMLElement): void {
    if (!this.cached) return;
    body.innerHTML = `
      <section class="kb-auth-card" aria-label="修改个人资料">
        <h3 class="kb-profile-edit-title">修改资料</h3>
        <form class="kb-auth-form kb-profile-edit-form" id="kbProfileEditForm" novalidate>
          <label>用户名
            <input name="username" type="text" inputmode="text" autocomplete="username" minlength="3" maxlength="24" pattern="[a-z0-9_]{3,24}" value="${escapeHtml(this.cached.username ?? '')}" placeholder="3-24 位小写字母、数字或下划线" required>
          </label>
          <label>显示名称
            <input name="displayName" type="text" maxlength="60" value="${escapeHtml(this.cached.displayName ?? '')}" placeholder="公开显示的名称">
          </label>
          <label>头像地址
            <input name="avatarUrl" type="url" inputmode="url" maxlength="2048" value="${escapeHtml(this.cached.avatarUrl ?? '')}" placeholder="https://…（可选）">
          </label>
          <label>个人简介
            <textarea name="bio" maxlength="280" placeholder="最多 280 字">${escapeHtml(this.cached.bio ?? '')}</textarea>
          </label>
          <button class="btn primary kb-auth-submit" type="submit">保存资料</button>
        </form>
        <button class="btn ghost kb-auth-back" id="kbProfileEditBack" type="button">取消</button>
        <div class="form-hint kb-auth-status" id="kbAccountStatus">一次填写并保存全部资料。</div>
      </section>`;

    body.querySelector('#kbProfileEditBack')?.addEventListener('click', () => this.open(false));
    body.querySelector<HTMLFormElement>('#kbProfileEditForm')?.addEventListener('submit', event => {
      event.preventDefault();
      void this.submitProfileEditForm(body, event.currentTarget as HTMLFormElement);
    });
  }

  private async submitProfileEditForm(body: HTMLElement, form: HTMLFormElement): Promise<void> {
    if (!this.account || !this.cached?.passwordLoginEnabled) {
      this.flashLoginRequired();
      return;
    }
    const username = formValue(form, 'username').trim().toLowerCase();
    const displayName = formValue(form, 'displayName').trim();
    const avatarUrl = formValue(form, 'avatarUrl').trim();
    const bio = formValue(form, 'bio').trim();

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      this.accountStatus(body, '用户名必须是 3-24 位小写字母、数字或下划线');
      return;
    }
    if (displayName.length > 60) {
      this.accountStatus(body, '显示名称最多 60 字');
      return;
    }
    if (avatarUrl && !safeAvatarUrl(avatarUrl)) {
      this.accountStatus(body, '头像地址必须是 HTTPS 链接');
      return;
    }
    if (bio.length > 280) {
      this.accountStatus(body, '个人简介最多 280 字');
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>('.kb-auth-submit');
    if (submit) submit.disabled = true;
    this.accountStatus(body, '正在保存资料…');
    try {
      this.cached = await this.account.updateProfile({ username, displayName, avatarUrl, bio });
      this.updateAvatar();
      this.open(false);
      const nextBody = this.options.accountOverlay?.querySelector<HTMLElement>('.modal-body');
      if (nextBody) this.accountStatus(nextBody, '资料已保存');
    } catch (error) {
      this.accountStatus(body, error instanceof Error ? error.message : '资料保存失败');
      if (submit) submit.disabled = false;
    }
  }

  private flashLoginRequired(): void {
    const toast = this.options.toast;
    if (!toast) return;
    if (this.loginRequiredTimer !== null) window.clearTimeout(this.loginRequiredTimer);
    toast.textContent = '请先登录账户';
    toast.classList.add('show');
    this.loginRequiredTimer = window.setTimeout(() => {
      toast.classList.remove('show');
      this.loginRequiredTimer = null;
    }, LOGIN_REQUIRED_MS);
  }

  private renderProfile(body: HTMLElement, profile: AccountProfile | null): void {
    const avatar = body.querySelector<HTMLElement>('#kbProfileAvatar');
    if (avatar) {
      avatar.replaceChildren();
      const src = safeAvatarUrl(profile?.avatarUrl);
      if (src) {
        const image = document.createElement('img');
        image.src = src;
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          image.remove();
          avatar.textContent = initial(profile);
        }, { once: true });
        avatar.append(image);
      } else {
        avatar.textContent = initial(profile);
      }
    }
    const set = (selector: string, value: string) => {
      const element = body.querySelector<HTMLElement>(selector);
      if (element) element.textContent = value;
    };
    set('#kbProfileName', name(profile));
    set('#kbProfileUsername', `@${profile?.username ?? '游客'}`);
    set('#kbProfileBio', profile?.bio ?? '个人资料、账户和知识节点掌握状态均绑定到唯一 user_id。');
    set('#kbAccountStatus', this.account
      ? profile?.passwordLoginEnabled ? '已登录账户' : '游客模式 · 修改资料前请先注册或登录'
      : '远程服务未配置；个人状态只能留在当前设备。');
  }

  private updateAvatar(): void {
    const avatar = this.options.avatarButton;
    if (!avatar) return;
    avatar.replaceChildren();
    const src = safeAvatarUrl(this.cached?.avatarUrl);
    if (src) {
      const image = document.createElement('img');
      image.src = src;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => {
        image.remove();
        avatar.textContent = initial(this.cached);
      }, { once: true });
      avatar.append(image);
    } else {
      avatar.textContent = initial(this.cached);
    }
    avatar.title = '个人空间 · 账户与知识记录';
    avatar.dataset.authState = this.cached?.passwordLoginEnabled ? 'registered' : 'guest';
  }

  private async sweepExpiredVoteRounds(): Promise<void> {
    if (!this.account || document.visibilityState === 'hidden') return;
    try {
      const processed = await this.account.settleExpiredPendingKnowledgeVotes(50);
      if (processed > 0) {
        window.dispatchEvent(new CustomEvent('knowledge-ball:verdict-finalized', { detail: { sweep: true } }));
      }
    } catch { /* offline/schema rollout: retry on the next low-frequency sweep */ }
  }

  private scheduleExpirySweep(): void {
    if (!this.account || this.expirySweepTimer !== null) return;
    this.expirySweepTimer = window.setTimeout(async () => {
      this.expirySweepTimer = null;
      await this.sweepExpiredVoteRounds();
      this.scheduleExpirySweep();
    }, EXPIRY_SWEEP_MS);
  }
}

export function installAccountUi(options: AccountUiOptions): AccountUiController {
  return new AccountUiController(options);
}

function formValue(form: HTMLFormElement, fieldName: string): string {
  const field = form.elements.namedItem(fieldName);
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : '';
}

function name(profile: AccountProfile | null): string {
  return profile?.displayName || profile?.username || '匿名探索者';
}

function initial(profile: AccountProfile | null): string {
  return name(profile).slice(0, 1).toUpperCase();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}
