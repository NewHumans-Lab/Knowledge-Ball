export const CORE_ONBOARDING_STORAGE_KEY = 'knowledge-ball.core-onboarding.v1';
export const CORE_ONBOARDING_STEP_IDS = ['zoom', 'rotate', 'longpress', 'tap', 'voice'] as const;
export type CoreOnboardingStepId = typeof CORE_ONBOARDING_STEP_IDS[number];
export type CoreOnboardingStatus = 'completed' | 'skipped';

const LOCALE_STORAGE_KEY = 'knowledge-ball.locale.v1';
const APP_STORAGE_PREFIX = 'knowledge-ball.';
const IGNORED_USAGE_KEYS = new Set([CORE_ONBOARDING_STORAGE_KEY, LOCALE_STORAGE_KEY]);

function safeLocalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function hasFinalStatus(storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    const status = storage.getItem(CORE_ONBOARDING_STORAGE_KEY);
    return status === 'completed' || status === 'skipped';
  } catch {
    return false;
  }
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

export function persistCoreOnboardingStatus(storage: Storage | null, status: CoreOnboardingStatus): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CORE_ONBOARDING_STORAGE_KEY, status);
    return true;
  } catch {
    return false;
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
    if (status) persistCoreOnboardingStatus(storage, status);
    window.removeEventListener('resize', render);
    window.removeEventListener('storage', onStorage);
    root.remove();
    document.documentElement.dataset.coreOnboarding = status ?? 'closed';
  };

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
  return () => cleanup();
}

const AUTO_START_ELIGIBLE = shouldOfferCoreOnboarding(safeLocalStorage());

function autoInstallCoreOnboarding(): void {
  if (!AUTO_START_ELIGIBLE) return;
  const storage = safeLocalStorage();
  const host = document.getElementById('canvasHost');
  if (!host) return;
  const labelsLayer = document.getElementById('labelsLayer');
  let attempts = 0;
  const waitForScene = () => {
    if (!document.documentElement.isConnected || !host.isConnected) return;
    attempts += 1;
    const sceneReady = Boolean(host.querySelector('canvas')) && Boolean(labelsLayer?.querySelector('.node-label'));
    if (sceneReady || attempts >= 240) {
      installCoreOnboarding(host, storage, AUTO_START_ELIGIBLE);
      return;
    }
    window.requestAnimationFrame(waitForScene);
  };
  window.requestAnimationFrame(waitForScene);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInstallCoreOnboarding, { once: true });
  } else {
    queueMicrotask(autoInstallCoreOnboarding);
  }
}
