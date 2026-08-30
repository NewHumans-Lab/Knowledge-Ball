import { getLocale, type AppLocale } from '../../i18n/Locale';

export type SystemCoreId = 'n1' | 'n2' | 'n16';

export interface SystemCoreDefinition {
  id: SystemCoreId;
  title: string;
  formula: string;
  description: string;
  author: 'Knowledge Ball';
}

type SystemCoreLocalizedCopy = Readonly<{
  title: string;
  description: string;
}>;

const SYSTEM_CORE_LOCALIZED_COPY: Readonly<Record<SystemCoreId, Readonly<Record<AppLocale, SystemCoreLocalizedCopy>>>> = Object.freeze({
  n1: {
    'zh-CN': {
      title: '同一律',
      description: '在同一语境和同一时间下，一个事物与其自身相同。',
    },
    en: {
      title: 'Law of Identity',
      description: 'A thing is identical to itself within the same context and at the same time.',
    },
  },
  n2: {
    'zh-CN': {
      title: '排中律',
      description: '在经典逻辑中，对于一个确定命题 P，P 与其否定 ¬P 必有一个成立。',
    },
    en: {
      title: 'Law of Excluded Middle',
      description: 'For a definite proposition in classical logic, either the proposition or its negation holds.',
    },
  },
  n16: {
    'zh-CN': {
      title: '矛盾律',
      description: '一个命题不能在同一时间、同一方面既为真又为假。',
    },
    en: {
      title: 'Law of Non-Contradiction',
      description: 'A proposition cannot be both true and false at the same time and in the same respect.',
    },
  },
});

const SYSTEM_CORE_UI_COPY: Readonly<Record<AppLocale, Readonly<{
  eyebrow: string;
  author: string;
  back: string;
}>>> = Object.freeze({
  'zh-CN': { eyebrow: '系统核心', author: '作者', back: '返回' },
  en: { eyebrow: 'SYSTEM CORE', author: 'Author', back: 'Return' },
});

export const SYSTEM_CORE_DEFINITIONS: readonly SystemCoreDefinition[] = Object.freeze([
  {
    id: 'n1',
    title: 'Law of Identity',
    formula: 'A = A',
    description: 'A thing is identical to itself within the same context and at the same time.',
    author: 'Knowledge Ball',
  },
  {
    id: 'n2',
    title: 'Law of Excluded Middle',
    formula: 'P ∨ ¬P',
    description: 'For a definite proposition in classical logic, either the proposition or its negation holds.',
    author: 'Knowledge Ball',
  },
  {
    id: 'n16',
    title: 'Law of Non-Contradiction',
    formula: '¬(P ∧ ¬P)',
    description: 'A proposition cannot be both true and false at the same time and in the same respect.',
    author: 'Knowledge Ball',
  },
]);

function coreById(id: string): SystemCoreDefinition | null {
  return SYSTEM_CORE_DEFINITIONS.find(core => core.id === id) ?? null;
}

export function systemCoreLabel(id: string, locale: AppLocale = getLocale()): string | null {
  const core = coreById(id);
  return core ? SYSTEM_CORE_LOCALIZED_COPY[core.id][locale].title : null;
}

export function systemCoreDisplayContent(id: string, locale: AppLocale = getLocale()) {
  const core = coreById(id);
  if (!core) return null;
  const copy = SYSTEM_CORE_LOCALIZED_COPY[core.id][locale];
  return {
    ...core,
    title: copy.title,
    description: copy.description,
  };
}

export function createSystemCoreSceneNodes() {
  return SYSTEM_CORE_DEFINITIONS.map(core => ({
    id: core.id,
    title: core.title,
    type: 'axiom' as const,
    status: 'verified' as const,
    mastery: 'none' as const,
    reasoning: core.description,
    premises: [] as string[],
    declaredLayer: 'core' as const,
    effectiveLayer: 'core' as const,
  }));
}

export function openSystemCoreCard(id: string, onReturn: () => void): boolean {
  if (typeof document === 'undefined') return false;
  const locale = getLocale();
  const core = systemCoreDisplayContent(id, locale);
  if (!core) return false;
  const ui = SYSTEM_CORE_UI_COPY[locale];

  document.getElementById('systemCoreOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'systemCoreOverlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', core.title);
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:240',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:22px',
    'background:rgba(6,9,17,.94)',
  ].join(';');

  const card = document.createElement('section');
  card.style.cssText = [
    'width:min(520px,100%)',
    'border:1px solid rgba(255,255,255,.16)',
    'border-radius:18px',
    'padding:28px 24px 22px',
    'background:linear-gradient(180deg,rgba(24,31,54,.98),rgba(12,17,32,.98))',
    'box-shadow:0 28px 90px rgba(0,0,0,.55)',
    'text-align:center',
    'color:#F6F8FF',
  ].join(';');

  const eyebrow = document.createElement('div');
  eyebrow.textContent = ui.eyebrow;
  eyebrow.style.cssText = 'font:600 11px/1.2 Inter,sans-serif;letter-spacing:2.1px;color:#AAB4D0;margin-bottom:15px';

  const title = document.createElement('h2');
  title.textContent = core.title;
  title.style.cssText = 'margin:0 0 14px;font:700 24px/1.3 Inter,sans-serif;color:#FFFFFF';

  const formula = document.createElement('div');
  formula.textContent = core.formula;
  formula.style.cssText = 'margin:0 auto 18px;padding:14px 18px;border-radius:12px;background:rgba(255,255,255,.055);font:600 22px/1.2 Georgia,serif;color:#FFFFFF';

  const description = document.createElement('p');
  description.textContent = core.description;
  description.style.cssText = 'margin:0 auto 20px;max-width:430px;font:400 14px/1.75 Inter,sans-serif;color:#C9D0E3';

  const author = document.createElement('div');
  author.textContent = `${ui.author} · ${core.author}`;
  author.style.cssText = 'margin:0 0 24px;font:500 12px/1.4 Inter,sans-serif;color:#8F9AB8';

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = ui.back;
  back.style.cssText = [
    'width:100%',
    'border:1px solid rgba(255,255,255,.18)',
    'border-radius:10px',
    'padding:12px 16px',
    'background:rgba(255,255,255,.06)',
    'color:#FFFFFF',
    'font:600 14px/1 Inter,sans-serif',
    'cursor:pointer',
  ].join(';');
  back.addEventListener('click', () => {
    overlay.remove();
    onReturn();
  }, { once: true });

  card.append(eyebrow, title, formula, description, author, back);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  back.focus();
  return true;
}
