export const CORE_ONBOARDING_STORAGE_KEY = 'knowledge-ball.core-onboarding.v1';
export const CORE_ONBOARDING_OWNER_KEY = 'knowledge-ball.core-onboarding-owner.v1';
export const CORE_ONBOARDING_STEP_IDS = ['zoom', 'rotate', 'longpress', 'tap', 'voice'] as const;
export type CoreOnboardingStepId = typeof CORE_ONBOARDING_STEP_IDS[number];
export type CoreOnboardingStatus = 'completed' | 'skipped';

const LOCALE_STORAGE_KEY = 'knowledge-ball.locale.v1';
const GUEST_SESSION_KEY = 'knowledge-ball.supabase-guest-session.v1';
const APP_STORAGE_PREFIX = 'knowledge-ball.';
const IGNORED_USAGE_KEYS = new Set([CORE_ONBOARDING_STORAGE_KEY, CORE_ONBOARDING_OWNER_KEY, LOCALE_STORAGE_KEY]);
const ACCOUNT_SYNC_WAIT_ATTEMPTS = 80;
const ACCOUNT_SYNC_WAIT_MS = 50;

type SessionIdentity = { accessToken: string; userId: string | null };
let activeOnboardingClose: (() => void) | null = null;

function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function finalStatus(storage: Storage | null): CoreOnboardingStatus | null {
  if (!storage) return null;
  try {
    const status = storage.getItem(CORE_ONBOARDING_STORAGE_KEY);
    return status === 'completed' || status === 'skipped' ? status : null;
  } catch {
    return null;
  }
}

function finalStatusOwner(storage: Storage | null): string | null {
  if (!storage) return null;
  try { return storage.getItem(CORE_ONBOARDING_OWNER_KEY); } catch { return null; }
}

function hasFinalStatus(storage: Storage | null): boolean {
  return finalStatus(storage) !== null;
}

function clearLocalFinalStatus(storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CORE_ONBOARDING_STORAGE_KEY);
    storage.removeItem(CORE_ONBOARDING_OWNER_KEY);
  } catch { /* optional local cache */ }
}

export function shouldOfferCoreOnboarding(storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    if (hasFinalStatus(storage)) return false;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(APP_STORAGE_PREFIX) || IGNORED_USAGE_KEYS.has(key)) continue;
      return false;
    }
    return true;
  } catch {
    // If durable storage is unavailable we cannot reliably distinguish a newcomer
    // from a returning user, so fail closed rather than repeatedly annoying users.
    return false;
  }
}

export function persistCoreOnboardingStatus(
  storage: Storage | null,
  status: CoreOnboardingStatus,
  ownerId?: string | null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CORE_ONBOARDING_STORAGE_KEY, status);
    if (ownerId) storage.setItem(CORE_ONBOARDING_OWNER_KEY, ownerId);
    else storage.removeItem(CORE_ONBOARDING_OWNER_KEY);
    return true;
  } catch {
    return false;
  }
}

function decodeJwtSubject(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload || typeof atob !== 'function') return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const decoded = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof decoded.sub === 'string' && decoded.sub ? decoded.sub : null;
  } catch {
    return null;
  }
}

function currentSessionIdentity(storage: Storage | null): SessionIdentity | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(GUEST_SESSION_KEY) ?? 'null') as Record<string, unknown> | null;
    const accessToken = typeof raw?.access_token === 'string' ? raw.access_token : '';
    if (!accessToken) return null;
    return { accessToken, userId: decodeJwtSubject(accessToken) };
  } catch {
    return null;
  }
}

function supabaseConfig(): { url: string; publishableKey: string } | null {
  const url = import.meta.env?.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && publishableKey ? { url: url.replace(/\/$/, ''), publishableKey } : null;
}

async function rpcRequest(
  config: { url: string; publishableKey: string },
  identity: SessionIdentity,
  rpc: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${config.url}/rest/v1/rpc/${rpc}`, {
    method: 'POST',
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${identity.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) throw new Error(`core onboarding account RPC ${rpc} failed (${response.status})`);
  return value;
}

async function ensureAccountProfile(
  config: { url: string; publishableKey: string },
  identity: SessionIdentity,
): Promise<void> {
  await rpcRequest(config, identity, 'ensure_anonymous_profile', {});
}

function accountStatusFrom(value: unknown): CoreOnboardingStatus | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const status = record.core_onboarding_status;
  return status === 'completed' || status === 'skipped' ? status : null;
}

async function readAccountStatus(
  config: { url: string; publishableKey: string },
  identity: SessionIdentity,
): Promise<CoreOnboardingStatus | null> {
  await ensureAccountProfile(config, identity);
  return accountStatusFrom(await rpcRequest(config, identity, 'get_my_account', {}));
}

async function writeAccountStatus(
  config: { url: string; publishableKey: string },
  identity: SessionIdentity,
  status: CoreOnboardingStatus,
): Promise<CoreOnboardingStatus | null> {
  await ensureAccountProfile(config, identity);
  return accountStatusFrom(await rpcRequest(config, identity, 'set_core_onboarding_status', { new_status: status }));
}

async function waitForSessionIdentity(storage: Storage | null): Promise<SessionIdentity | null> {
  for (let attempt = 0; attempt < ACCOUNT_SYNC_WAIT_ATTEMPTS; attempt += 1) {
    const identity = currentSessionIdentity(storage);
    if (identity) return identity;
    await new Promise(resolve => window.setTimeout(resolve, ACCOUNT_SYNC_WAIT_MS));
  }
  return null;
}

async function reconcileCoreOnboardingAccount(initialEligible: boolean): Promise<boolean> {
  const storage = safeLocalStorage();
  const config = supabaseConfig();
  if (!storage || !config) return initialEligible && !hasFinalStatus(storage);

  const identity = await waitForSessionIdentity(storage);
  if (!identity) return initialEligible && !hasFinalStatus(storage);

  let localStatus = finalStatus(storage);
  let localOwner = finalStatusOwner(storage);
  if (localStatus && localOwner && identity.userId && localOwner !== identity.userId) {
    // One installation may sign into another account. Never upload account A's
    // dismissal to account B. The previous account is protected by its cloud copy.
    clearLocalFinalStatus(storage);
    localStatus = null;
    localOwner = null;
  }

  try {
    const remoteStatus = await readAccountStatus(config, identity);
    if (remoteStatus) {
      persistCoreOnboardingStatus(storage, remoteStatus, identity.userId);
      activeOnboardingClose?.();
      return false;
    }

    if (localStatus && (!localOwner || !identity.userId || localOwner === identity.userId)) {
      await writeAccountStatus(config, identity, localStatus);
      persistCoreOnboardingStatus(storage, localStatus, identity.userId);
      return false;
    }

    if (!initialEligible) {
      // Existing users are intentionally excluded from rollout. Backfill that
      // exclusion to the identity so a new device does not incorrectly treat
      // the same existing user as a newcomer later.
      const stored = await writeAccountStatus(config, identity, 'skipped');
      persistCoreOnboardingStatus(storage, stored ?? 'skipped', identity.userId);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[Knowledge-Ball] core onboarding account sync deferred:', error);
    return initialEligible && !hasFinalStatus(storage);
  }
}

async function persistFinalStatusToAccount(status: CoreOnboardingStatus): Promise<void> {
  const storage = safeLocalStorage();
  const config = supabaseConfig();
  const identity = currentSessionIdentity(storage);
  if (!storage || !config || !identity) return;
  try {
    const stored = await writeAccountStatus(config, identity, status);
    persistCoreOnboardingStatus(storage, stored ?? status, identity.userId);
  } catch (error) {
    // The local final state remains authoritative for this installation and is
    // retried on the next account reconciliation after connectivity returns.
    console.warn('[Knowledge-Ball] core onboarding account write deferred:', error);
  }
}

type StepCopy = { title: string; body: string };
type Copy = {
  eyebrow: string;
  skip: string;
  next: string;
  finish: string;
  progress: (current: number, total: number) => string;
  steps: Record<CoreOnboardingStepId, StepCopy>;
};

const COPY: Record<'zh-CN' | 'en', Copy> = {
  'zh-CN': {
    eyebrow: '核心操作',
    skip: '跳过',
    next: '下一步',
    finish: '完成',
    progress: (current, total) => `${current} / ${total}`,
    steps: {
      zoom: { title: '缩放', body: '双指捏合，或使用鼠标滚轮，放大和缩小知识球。' },
      rotate: { title: '旋转', body: '按住空白区域拖动，旋转整个知识球。' },
      longpress: { title: '长按', body: '长按一个知识节点约 1 秒，聚焦它所在的知识链。' },
      tap: { title: '点击', body: '点击知识节点，打开这个节点的详细信息。' },
      voice: { title: '语音', body: '打开节点详情后，点击顶部的麦克风进入该知识节点的语音房。' },
    },
  },
  en: {
    eyebrow: 'Core controls',
    skip: 'Skip',
    next: 'Next',
    finish: 'Done',
    progress: (current, total) => `${current} / ${total}`,
    steps: {
      zoom: { title: 'Zoom', body: 'Pinch with two fingers, or use the mouse wheel, to zoom the Knowledge Ball.' },
      rotate: { title: 'Rotate', body: 'Press and drag an empty area to rotate the whole Knowledge Ball.' },
      longpress: { title: 'Long press', body: 'Press and hold a knowledge node for about 1 second to focus its knowledge chain.' },
      tap: { title: 'Tap', body: 'Tap a knowledge node to open its details.' },
      voice: { title: 'Voice', body: 'After opening node details, tap the microphone at the top to enter that node’s voice room.' },
    },
  },
};

function currentCopy(): Copy {
  return document.documentElement.lang.toLowerCase().startsWith('en') ? COPY.en : COPY['zh-CN'];
}

function installStyles(): void {
  if (document.getElementById('kb-core-onboarding-style')) return;
  const style = document.createElement('style');
  style.id = 'kb-core-onboarding-style';
  style.textContent = `
    .kb-core-onboarding{position:fixed;inset:0;z-index:1200;pointer-events:none;font-family:Inter,'Noto Sans SC',system-ui,sans-serif}
    .kb-core-onboarding-spotlight{position:fixed;z-index:0;border:2px solid rgba(119,225,255,.88);box-shadow:0 0 0 9999px rgba(2,7,18,.68),0 0 26px rgba(85,236,255,.24);pointer-events:none;transition:left .18s ease,top .18s ease,width .18s ease,height .18s ease,border-radius .18s ease}
    .kb-core-onboarding-card{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));z-index:1;width:min(420px,calc(100vw - 28px));transform:translateX(-50%);box-sizing:border-box;padding:16px 16px 14px;border:1px solid rgba(119,225,255,.30);border-radius:16px;background:rgba(8,13,32,.96);box-shadow:0 18px 48px rgba(0,0,0,.42);color:#F3F8FF;pointer-events:none;backdrop-filter:blur(12px)}
    .kb-core-onboarding-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#77E1FF}
    .kb-core-onboarding-title{margin:7px 0 5px;font-size:20px;line-height:1.2;font-weight:750;color:#F7FBFF}
    .kb-core-onboarding-body{margin:0;color:#C6D2E5;font-size:14px;line-height:1.55}
    .kb-core-onboarding-footer{display:flex;align-items:center;gap:10px;margin-top:14px}
    .kb-core-onboarding-progress{margin-right:auto;color:#71829D;font-size:12px;font-variant-numeric:tabular-nums}
    .kb-core-onboarding-button{min-width:76px;min-height:44px;padding:9px 14px;border-radius:11px;border:1px solid rgba(119,225,255,.28);background:transparent;color:#DCE7F7;font:700 13px/1 Inter,'Noto Sans SC',system-ui,sans-serif;cursor:pointer;pointer-events:auto}
    .kb-core-onboarding-button:hover,.kb-core-onboarding-button:focus-visible{border-color:#77E1FF;outline:none}
    .kb-core-onboarding-next{background:rgba(85,236,255,.13);color:#F5FCFF}
    @media(max-width:640px){.kb-core-onboarding-card{bottom:max(16px,env(safe-area-inset-bottom));padding:14px}.kb-core-onboarding-title{font-size:18px}.kb-core-onboarding-body{font-size:13px}}
    @media(prefers-reduced-motion:reduce){.kb-core-onboarding-spotlight{transition:none}}
  `;
  document.head.appendChild(style);
}

type Rect = { left: number; top: number; width: number; height: number; radius: number };

function clampRect(rect: Rect): Rect {
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - margin - rect.width));
  const top = Math.max(margin, Math.min(rect.top, window.innerHeight - margin - rect.height));
  return { ...rect, left, top };
}

function sceneRect(host: HTMLElement): Rect {
  const box = host.getBoundingClientRect();
  const inset = 8;
  return clampRect({
    left: box.left + inset,
    top: box.top + inset,
    width: Math.max(72, box.width - inset * 2),
    height: Math.max(72, box.height - inset * 2),
    radius: 18,
  });
}

function visibleNodeRect(): Rect | null {
  const labels = document.querySelectorAll<HTMLElement>('.node-label');
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels.item(index);
    const box = label.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 48 || x > window.innerWidth - 48 || y < 72 || y > window.innerHeight - 120) continue;
    const size = 112;
    return clampRect({ left: x - size / 2, top: y - size / 2, width: size, height: size, radius: size / 2 });
  }
  return null;
}

function visibleVoiceButtonRect(): Rect | null {
  const button = document.querySelector<HTMLElement>('#nodeDetailOverlay.open .voice-detail-mic');
  if (!button) return null;
  const box = button.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  const size = Math.max(76, Math.max(box.width, box.height) + 24);
  return clampRect({
    left: box.left + box.width / 2 - size / 2,
    top: box.top + box.height / 2 - size / 2,
    width: size,
    height: size,
    radius: size / 2,
  });
}

function spotlightRect(host: HTMLElement, step: CoreOnboardingStepId): Rect {
  if (step === 'zoom' || step === 'rotate') return sceneRect(host);
  if (step === 'voice') return visibleVoiceButtonRect() ?? visibleNodeRect() ?? sceneRect(host);
  return visibleNodeRect() ?? sceneRect(host);
}

function applySpotlight(element: HTMLElement, rect: Rect): void {
  element.style.left = `${Math.round(rect.left)}px`;
  element.style.top = `${Math.round(rect.top)}px`;
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.height = `${Math.round(rect.height)}px`;
  element.style.borderRadius = `${Math.round(rect.radius)}px`;
}

export function installCoreOnboarding(
  host: HTMLElement,
  storage = safeLocalStorage(),
  eligible = shouldOfferCoreOnboarding(storage),
): (() => void) | null {
  if (!eligible || hasFinalStatus(storage)) return null;
  if (document.querySelector('.kb-core-onboarding')) return null;
  installStyles();

  const root = document.createElement('section');
  root.className = 'kb-core-onboarding';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Knowledge Ball core controls guide');
  root.innerHTML = `
    <div class="kb-core-onboarding-spotlight" aria-hidden="true"></div>
    <div class="kb-core-onboarding-card">
      <div class="kb-core-onboarding-eyebrow"></div>
      <h2 class="kb-core-onboarding-title"></h2>
      <p class="kb-core-onboarding-body"></p>
      <div class="kb-core-onboarding-footer">
        <span class="kb-core-onboarding-progress"></span>
        <button type="button" class="kb-core-onboarding-button kb-core-onboarding-skip"></button>
        <button type="button" class="kb-core-onboarding-button kb-core-onboarding-next"></button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  document.documentElement.dataset.coreOnboarding = 'active';

  const spotlight = root.querySelector<HTMLElement>('.kb-core-onboarding-spotlight')!;
  const eyebrow = root.querySelector<HTMLElement>('.kb-core-onboarding-eyebrow')!;
  const title = root.querySelector<HTMLElement>('.kb-core-onboarding-title')!;
  const body = root.querySelector<HTMLElement>('.kb-core-onboarding-body')!;
  const progress = root.querySelector<HTMLElement>('.kb-core-onboarding-progress')!;
  const skipButton = root.querySelector<HTMLButtonElement>('.kb-core-onboarding-skip')!;
  const nextButton = root.querySelector<HTMLButtonElement>('.kb-core-onboarding-next')!;
  let stepIndex = 0;
  let disposed = false;

  const render = () => {
    const copy = currentCopy();
    const stepId = CORE_ONBOARDING_STEP_IDS[stepIndex]!;
    const step = copy.steps[stepId];
    root.dataset.step = stepId;
    eyebrow.textContent = copy.eyebrow;
    title.textContent = step.title;
    body.textContent = step.body;
    progress.textContent = copy.progress(stepIndex + 1, CORE_ONBOARDING_STEP_IDS.length);
    skipButton.textContent = copy.skip;
    nextButton.textContent = stepIndex === CORE_ONBOARDING_STEP_IDS.length - 1 ? copy.finish : copy.next;
    applySpotlight(spotlight, spotlightRect(host, stepId));
  };

  const cleanup = (status?: CoreOnboardingStatus) => {
    if (disposed) return;
    disposed = true;
    if (status) {
      const identity = currentSessionIdentity(storage);
      persistCoreOnboardingStatus(storage, status, identity?.userId);
      void persistFinalStatusToAccount(status);
    }
    window.removeEventListener('resize', render);
    window.removeEventListener('storage', onStorage);
    root.remove();
    if (activeOnboardingClose === closeWithoutStatus) activeOnboardingClose = null;
    document.documentElement.dataset.coreOnboarding = status ?? 'closed';
  };

  const closeWithoutStatus = () => cleanup();
  activeOnboardingClose = closeWithoutStatus;

  const onStorage = (event: StorageEvent) => {
    if (event.key !== CORE_ONBOARDING_STORAGE_KEY) return;
    if (event.newValue === 'completed' || event.newValue === 'skipped') cleanup();
  };

  skipButton.addEventListener('click', () => cleanup('skipped'));
  nextButton.addEventListener('click', () => {
    if (stepIndex >= CORE_ONBOARDING_STEP_IDS.length - 1) {
      cleanup('completed');
      return;
    }
    stepIndex += 1;
    render();
  });
  window.addEventListener('resize', render, { passive: true });
  window.addEventListener('storage', onStorage);
  render();
  queueMicrotask(() => nextButton.focus({ preventScroll: true }));
  return closeWithoutStatus;
}

const AUTO_START_ELIGIBLE = shouldOfferCoreOnboarding(safeLocalStorage());

function waitForSceneAndInstall(eligible: boolean): void {
  if (!eligible) return;
  const storage = safeLocalStorage();
  const host = document.getElementById('canvasHost');
  if (!host) return;
  const labelsLayer = document.getElementById('labelsLayer');
  let attempts = 0;
  const waitForScene = () => {
    if (!document.documentElement.isConnected || !host.isConnected || hasFinalStatus(storage)) return;
    attempts += 1;
    const sceneReady = Boolean(host.querySelector('canvas')) && Boolean(labelsLayer?.querySelector('.node-label'));
    if (sceneReady || attempts >= 240) {
      installCoreOnboarding(host, storage, eligible);
      return;
    }
    window.requestAnimationFrame(waitForScene);
  };
  window.requestAnimationFrame(waitForScene);
}

async function autoInstallCoreOnboarding(): Promise<void> {
  const eligible = await reconcileCoreOnboardingAccount(AUTO_START_ELIGIBLE);
  waitForSceneAndInstall(eligible);
}

async function watchForIdentityChange(previousToken: string | null): Promise<void> {
  const storage = safeLocalStorage();
  for (let attempt = 0; attempt < ACCOUNT_SYNC_WAIT_ATTEMPTS * 3; attempt += 1) {
    const identity = currentSessionIdentity(storage);
    if (identity?.accessToken && identity.accessToken !== previousToken) {
      const eligible = await reconcileCoreOnboardingAccount(AUTO_START_ELIGIBLE);
      if (eligible && !document.querySelector('.kb-core-onboarding')) waitForSceneAndInstall(true);
      return;
    }
    await new Promise(resolve => window.setTimeout(resolve, ACCOUNT_SYNC_WAIT_MS));
  }
}

function installAccountIdentityWatcher(): void {
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'kbAuthForm') return;
    const previousToken = currentSessionIdentity(safeLocalStorage())?.accessToken ?? null;
    void watchForIdentityChange(previousToken);
  }, true);
}

if (typeof window !== 'undefined') {
  installAccountIdentityWatcher();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void autoInstallCoreOnboarding(); }, { once: true });
  } else {
    queueMicrotask(() => { void autoInstallCoreOnboarding(); });
  }
}
