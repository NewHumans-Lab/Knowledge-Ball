import { SYSTEM_TEXT_CATALOG, type SystemTextKey } from './SystemCatalog';

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type AppLocale = typeof SUPPORTED_LOCALES[number];
export const LOCALE_STORAGE_KEY = 'knowledge-ball.locale.v1';

const en = {
  'app.account': 'Account', 'app.settings': 'Settings', 'app.current': 'Current',
  'app.search': 'Ask a question or search knowledge…', 'app.send': 'Search',
  'app.close': 'Back to Knowledge Ball', 'app.backNodeDetail': 'Back to node details', 'app.cancel': 'Cancel', 'app.submit': 'Submit knowledge',
  'app.brandTagline': 'Living relational field',
  'settings.title': 'Settings', 'settings.appearance': 'Knowledge node sphere',
  'settings.radius': 'Sphere radius (mm)', 'settings.labels': 'Knowledge node labels',
  'settings.fontSize': 'Font size', 'settings.color': 'Color', 'settings.font': 'Font',
  'settings.brightness': 'Brightness', 'settings.font.default': 'Default sans serif',
  'settings.font.serif': 'Serif', 'settings.font.mono': 'Monospace',
  'settings.language': 'Language', 'settings.downloads': 'Downloads',
  'settings.downloads.hint': 'Get Knowledge Ball for your platform',
  'settings.whitePaper': 'White Paper', 'settings.whitePaper.hint': 'Read the English edition',
  'downloads.title': 'Downloads', 'downloads.back': 'Back to Settings',
  'downloads.ios.title': 'Apple / iOS', 'downloads.ios.meta': 'Version 0.2.0 · iOS 14 or later. Install with Safari.',
  'downloads.ios.action': 'Install iOS app', 'downloads.android.title': 'Android',
  'downloads.android.meta': 'Version 0.2.0 · Android 7.0 or later.',
  'downloads.android.action': 'Download Android APK', 'downloads.windows.title': 'Windows',
  'downloads.windows.meta': 'A Windows installer is not available in this repository.',
  'downloads.unavailable': 'Not available yet', 'downloads.update': 'Check for updates',
  'downloads.share': 'Share current version',
  'legend.title': 'Knowledge Layers', 'legend.inner': 'Layer 1 · Semantics and foundational facts',
  'legend.middle': 'Layer 2 · Rigorous reasoning', 'legend.outer': 'Layer 3 · Probability and dispute',
  'legend.help': 'Layer 1 contains static semantic relations; Layer 2 expresses reasoning structures; Layer 3 expresses disputed or explicitly uncertain/probabilistic knowledge.',
  'account.title': 'Account', 'account.auth': 'Authentication status', 'account.verified': 'Verified · credential-based',
  'account.reputation': 'Reputation', 'account.lit': 'Knowledge nodes explored', 'account.contributions': 'My contributions',
  'create.title': 'Submit a new knowledge node', 'create.name': 'Knowledge title', 'create.name.placeholder': 'Enter a knowledge title',
  'create.layer': 'Knowledge layer', 'create.description': 'Knowledge description',
  'create.description.placeholder': 'Enter the complete knowledge description…', 'create.reasoning': 'Reasoning',
  'create.reasoning.placeholder': 'Explain how the selected premises lead to this conclusion…',
  'create.premises': 'Prerequisite knowledge (multiple allowed)', 'create.rule': 'Logic symbol (reasoning classification)',
  'create.rule.hint': 'Optionally identify an existing formal rule; this is not required for submission.',
  'taxonomy.inner': 'Layer 1 · Semantics and foundational facts', 'taxonomy.middle': 'Layer 2 · Rigorous reasoning',
  'taxonomy.outer': 'Layer 3 · Probability and dispute',
  'mobile.offline': 'Offline · local knowledge remains available',
  'mobile.checking': 'Checking for the latest version…', 'mobile.latest': 'You have the latest version v{version}',
  'mobile.found': 'Found v{version}; opening the installer…', 'mobile.updateError': 'Update check failed. Check your network and try again.',
  'mobile.preparing': 'Preparing the current installer…', 'mobile.shared': 'The installer was sent to the system share sheet.',
  'mobile.shareError': 'Could not prepare sharing. Check network and storage, then retry.',
  'mobile.iosShared': 'The install link was sent to the system share sheet.', 'mobile.iosShareError': 'Sharing failed. Please try again.',
  'mobile.androidShareTitle': 'Knowledge Ball Android v{version}',
  'mobile.androidShareText': 'Knowledge Ball Android current version v{version}',
  'mobile.androidShareDialog': 'Share Knowledge Ball installer',
  'mobile.iosShareTitle': 'Knowledge Ball iOS v{version}',
  'mobile.iosShareText': 'Knowledge Ball iOS current version v{version}. Open with Safari to install.',
  'mobile.iosShareDialog': 'Share Knowledge Ball iOS app',
  'sync.unavailableTitle': 'Remote database not configured · public knowledge is read-only and local public data is not authoritative',
  'sync.status': 'Sync status: {status}',
  'sync.unavailableToast': 'Remote database is not configured; only cloud public knowledge is authoritative, so this page cannot submit public changes.',
  'sync.conflictToast': 'Server data changed. Retry the public operation.',
} as const;

export type TranslationKey = keyof typeof en;
const zhCN: Record<TranslationKey, string> = {
  'app.account':'个人账户','app.settings':'设置','app.current':'当前','app.search':'输入问题，或搜索知识节点…','app.send':'搜索','app.close':'返回知识球','app.backNodeDetail':'返回节点详情','app.cancel':'取消','app.submit':'提交知识','app.brandTagline':'动态关系知识场',
  'settings.title':'设置','settings.appearance':'知识节点球体','settings.radius':'球体半径 (mm)','settings.labels':'知识节点文字标签','settings.fontSize':'字号','settings.color':'颜色','settings.font':'字体','settings.brightness':'亮度','settings.font.default':'默认无衬线','settings.font.serif':'衬线（宋体风格）','settings.font.mono':'等宽','settings.language':'语言','settings.downloads':'下载','settings.downloads.hint':'获取适合你平台的知识球','settings.whitePaper':'白皮书','settings.whitePaper.hint':'查看中文版',
  'downloads.title':'下载','downloads.back':'返回设置','downloads.ios.title':'Apple / iOS','downloads.ios.meta':'版本 0.2.0 · iOS 14 及以上。使用 Safari 安装。','downloads.ios.action':'安装 iOS 应用','downloads.android.title':'Android','downloads.android.meta':'版本 0.2.0 · Android 7.0 及以上。','downloads.android.action':'下载 Android 安装包（APK）','downloads.windows.title':'Windows','downloads.windows.meta':'此仓库目前没有 Windows 安装程序。','downloads.unavailable':'暂未提供','downloads.update':'检查更新','downloads.share':'分享当前版本',
  'legend.title':'知识层级','legend.inner':'第一层 · 语义与基础事实','legend.middle':'第二层 · 严谨推理','legend.outer':'第三层 · 概率与争议','legend.help':'第一层包括静态语义关系；第二层只表达推理结构；第三层表达争议或提交时明确声明的不确定 / 概率知识。',
  'account.title':'个人账户','account.auth':'身份验证状态','account.verified':'已验证 · 凭证式','account.reputation':'声誉积分','account.lit':'已点亮知识节点','account.contributions':'本人贡献节点数',
  'create.title':'提交新知识节点','create.name':'知识标题','create.name.placeholder':'填写知识标题','create.layer':'知识层级','create.description':'知识描述','create.description.placeholder':'填写知识本身的完整描述…','create.reasoning':'推理过程','create.reasoning.placeholder':'逐步说明如何从所选前提推出该结论…','create.premises':'前置知识点（依赖边，可多选）','create.rule':'逻辑符号（推理分类）','create.rule.hint':'若该推理使用已有正式规则，可在这里标记；不作为提交门槛。','taxonomy.inner':'第一层 · 语义与基础事实','taxonomy.middle':'第二层 · 严谨推理','taxonomy.outer':'第三层 · 概率与争议',
  'mobile.offline':'当前离线 · 本地知识图谱仍可浏览','mobile.checking':'正在检查最新版…','mobile.latest':'当前已是最新版 v{version}','mobile.found':'发现 v{version}，正在打开安装页面…','mobile.updateError':'检查更新失败，请确认网络后重试。','mobile.preparing':'正在准备当前版本安装包…','mobile.shared':'安装包已交给系统分享面板。','mobile.shareError':'准备分享失败，请确认网络和存储空间后重试。','mobile.iosShared':'安装地址已交给系统分享面板。','mobile.iosShareError':'分享失败，请稍后重试。',
  'mobile.androidShareTitle':'知识球 Android v{version}','mobile.androidShareText':'知识球 Android 当前版本 v{version}','mobile.androidShareDialog':'分享知识球安装包','mobile.iosShareTitle':'知识球 iOS v{version}','mobile.iosShareText':'知识球 iOS 当前版本 v{version}，使用 Safari 打开即可安装。','mobile.iosShareDialog':'分享知识球 iOS 应用',
  'sync.unavailableTitle':'远程数据库未配置 · 公共知识只读，本地公共数据不被承认','sync.status':'同步状态：{status}','sync.unavailableToast':'远程数据库未配置；公共知识只认云端，当前页面不能提交公共修改','sync.conflictToast':'服务器数据已变化，请重试刚才的公共操作',
};

export const catalogs: Readonly<Record<AppLocale, Readonly<Record<TranslationKey, string>>>> = { 'zh-CN': zhCN, en };
export const legacySystemTextCatalog = SYSTEM_TEXT_CATALOG;

type RuntimeKey = TranslationKey | SystemTextKey;
let locale = initialLocale();
const listeners = new Set<(locale: AppLocale) => void>();
let runtimeObserver: MutationObserver | null = null;
const translatedTextNodes = new WeakMap<Text, RuntimeKey>();
const translatedAttributes = new WeakMap<Element, Map<string, RuntimeKey>>();

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function initialLocale(): AppLocale {
  const stored = safeStorage()?.getItem(LOCALE_STORAGE_KEY);
  return stored === 'zh-CN' || stored === 'en' ? stored : 'zh-CN';
}

export const getLocale = (): AppLocale => locale;
export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  return interpolate(catalogs[locale][key], values);
}
function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

function systemText(key: RuntimeKey): string {
  if (key in catalogs.en) return catalogs[locale][key as TranslationKey];
  return SYSTEM_TEXT_CATALOG[key as SystemTextKey][locale];
}

function systemTextVariants(key: RuntimeKey): readonly string[] {
  if (key in catalogs.en) {
    const translationKey = key as TranslationKey;
    return [catalogs.en[translationKey], catalogs['zh-CN'][translationKey]];
  }
  const systemKey = key as SystemTextKey;
  return [SYSTEM_TEXT_CATALOG[systemKey].en, SYSTEM_TEXT_CATALOG[systemKey]['zh-CN']];
}

const literalLookup = new Map<string, RuntimeKey>();
for (const key of Object.keys(en) as TranslationKey[]) {
  literalLookup.set(en[key], key);
  literalLookup.set(zhCN[key], key);
}
literalLookup.set('LIVING RELATIONAL FIELD', 'app.brandTagline');
for (const key of Object.keys(SYSTEM_TEXT_CATALOG) as SystemTextKey[]) {
  literalLookup.set(SYSTEM_TEXT_CATALOG[key].en, key);
  literalLookup.set(SYSTEM_TEXT_CATALOG[key]['zh-CN'], key);
}

const USER_TEXT_SELECTOR = [
  '.field .val', '.chip[data-jump]', '.premise-item',
  '.node-detail-title', '.node-detail-content', '[data-related-node-id]', '.node-detail-meta b',
  '#kbProfileName', '#kbProfileUsername', '#kbProfileBio',
  '.knowledge-picker-chip', '.knowledge-picker-option > span',
  '.search-item[data-node-id] > span',
  '#fLogicRule option:not([value=""])', '#decomposeConclusion option',
  'input', 'textarea',
].join(',');
const USER_ATTRIBUTE_SELECTOR = [
  '[data-related-node-id]', '#kbProfileName', '#kbProfileUsername', '#kbProfileBio',
  '.knowledge-picker-chip', '.knowledge-picker-option > span', '.search-item[data-node-id] > span',
].join(',');

function isUserTextElement(element: Element | null): boolean {
  return Boolean(element?.closest(USER_TEXT_SELECTOR));
}
function isUserAttributeElement(element: Element | null): boolean {
  return Boolean(element?.closest(USER_ATTRIBUTE_SELECTOR));
}

function withOuterWhitespace(original: string, translated: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function translateWrappedUserValue(value: string): string | null {
  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = locale === 'en'
    ? [
        [/^节点已提交：(.*)$/s, m => `Node submitted: ${m[1]}`],
        [/^推理已提交：(.*)$/s, m => `Reasoning submitted: ${m[1]}`],
        [/^已预选「(.*)」作为推理前提；因此默认进入第二层。$/s, m => `“${m[1]}” is preselected as a reasoning premise, so Layer 2 is selected by default.`],
        [/^编辑节点 · 优化：(.*)$/s, m => `Edit node · Optimize: ${m[1]}`],
        [/^编辑节点 · 对立观点：(.*)$/s, m => `Edit node · Opposition: ${m[1]}`],
        [/^分解：(.*)$/s, m => `Decompose: ${m[1]}`],
      ]
    : [
        [/^Node submitted: (.*)$/s, m => `节点已提交：${m[1]}`],
        [/^Reasoning submitted: (.*)$/s, m => `推理已提交：${m[1]}`],
        [/^“(.*)” is preselected as a reasoning premise, so Layer 2 is selected by default\.$/s, m => `已预选「${m[1]}」作为推理前提；因此默认进入第二层。`],
        [/^Edit node · Optimize: (.*)$/s, m => `编辑节点 · 优化：${m[1]}`],
        [/^Edit node · Opposition: (.*)$/s, m => `编辑节点 · 对立观点：${m[1]}`],
        [/^Decompose: (.*)$/s, m => `分解：${m[1]}`],
      ];
  for (const [pattern, render] of patterns) {
    const match = value.match(pattern);
    if (match) return render(match);
  }
  return null;
}

function addTemplatePairs(pairs: Array<[string, string]>, from: string, to: string): void {
  pairs.push([from, to]);
  const fromParts = from.split(/\{[^}]+\}/);
  const toParts = to.split(/\{[^}]+\}/);
  if (fromParts.length !== toParts.length || fromParts.length < 2) return;
  for (let index = 0; index < fromParts.length; index += 1) {
    if (fromParts[index] && toParts[index]) pairs.push([fromParts[index], toParts[index]]);
  }
}

function replacementPairs(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const source: AppLocale = locale === 'en' ? 'zh-CN' : 'en';
  for (const key of Object.keys(en) as TranslationKey[]) {
    addTemplatePairs(pairs, catalogs[source][key], catalogs[locale][key]);
  }
  for (const key of Object.keys(SYSTEM_TEXT_CATALOG) as SystemTextKey[]) {
    addTemplatePairs(pairs, SYSTEM_TEXT_CATALOG[key][source], SYSTEM_TEXT_CATALOG[key][locale]);
  }
  return pairs
    .filter(([from, to]) => from && from !== to)
    .sort((left, right) => right[0].length - left[0].length);
}

function translateSystemTokens(value: string): string {
  let translated = value;
  for (const [from, to] of replacementPairs()) {
    if (translated.includes(from)) translated = translated.split(from).join(to);
  }
  return translated;
}

/**
 * Safe boundary for arbitrary strings: exact known system literals and known
 * system wrappers may translate, but free text is returned byte-for-byte.
 * User/community knowledge values must use this boundary if they ever pass
 * through localization code outside the DOM ownership checks below.
 */
export function translateRuntimeSystemText(value: string): string {
  const direct = literalLookup.get(value);
  if (direct) return systemText(direct);
  return translateWrappedUserValue(value) ?? value;
}

/** Broad token translation is allowed only after DOM ownership proves the node
 * is system-owned. It must never be called for arbitrary user/community text. */
function translateSystemOwnedText(value: string): string {
  const direct = literalLookup.get(value);
  if (direct) return systemText(direct);
  const wrapped = translateWrappedUserValue(value);
  if (wrapped !== null) return wrapped;
  return translateSystemTokens(value);
}

function localizePanelTitle(node: Text, original: string): boolean {
  if (!node.parentElement?.closest('#panelTitle')) return false;
  const core = original.trim();
  const wrapped = translateWrappedUserValue(core);
  if (wrapped !== null) node.nodeValue = withOuterWhitespace(original, wrapped);
  return true;
}

function localizeTextNode(node: Text): void {
  const original = node.nodeValue ?? '';
  const core = original.trim();
  if (!core) return;
  if (localizePanelTitle(node, original)) return;
  if (isUserTextElement(node.parentElement)) return;
  const remembered = translatedTextNodes.get(node);
  if (remembered) {
    const desired = withOuterWhitespace(original, systemText(remembered));
    if (node.nodeValue !== desired) node.nodeValue = desired;
    return;
  }
  const key = literalLookup.get(core);
  if (key) {
    translatedTextNodes.set(node, key);
    const desired = withOuterWhitespace(original, systemText(key));
    if (node.nodeValue !== desired) node.nodeValue = desired;
    return;
  }
  const translated = translateSystemOwnedText(core);
  if (translated !== core) node.nodeValue = withOuterWhitespace(original, translated);
}

function localizeAttribute(element: Element, name: 'placeholder' | 'aria-label' | 'title'): void {
  if (isUserAttributeElement(element)) return;
  const raw = element.getAttribute(name);
  const value = raw?.trim();
  if (!raw || !value) return;
  const byName = translatedAttributes.get(element);
  const remembered = byName?.get(name);
  if (remembered) {
    if (systemTextVariants(remembered).includes(value)) {
      const desired = systemText(remembered);
      if (raw !== desired) element.setAttribute(name, desired);
      return;
    }
    // The controller intentionally changed this attribute's semantic meaning.
    // Drop the stale key before resolving the newly assigned system label.
    byName?.delete(name);
  }
  const key = literalLookup.get(value);
  if (key) {
    let nextByName = translatedAttributes.get(element);
    if (!nextByName) {
      nextByName = new Map();
      translatedAttributes.set(element, nextByName);
    }
    nextByName.set(name, key);
    const desired = systemText(key);
    if (raw !== desired) element.setAttribute(name, desired);
    return;
  }
  const translated = translateSystemOwnedText(value);
  if (translated !== value && raw !== translated) element.setAttribute(name, translated);
}

function applyRuntimeTranslations(root: ParentNode): void {
  if (typeof document === 'undefined') return;
  const processElement = (element: Element) => {
    localizeAttribute(element, 'placeholder');
    localizeAttribute(element, 'aria-label');
    localizeAttribute(element, 'title');
  };
  if (root instanceof Element) processElement(root);
  root.querySelectorAll('*').forEach(processElement);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) localizeTextNode(current as Text);
}

export function applyDocumentTranslations(root: ParentNode = document): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(element => {
    const key = element.dataset.i18n as TranslationKey;
    const desired = t(key);
    if (element.textContent !== desired) element.textContent = desired;
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(element => {
    const desired = t(element.dataset.i18nPlaceholder as TranslationKey);
    if (element.getAttribute('placeholder') !== desired) element.setAttribute('placeholder', desired);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(element => {
    const desired = t(element.dataset.i18nAria as TranslationKey);
    if (element.getAttribute('aria-label') !== desired) element.setAttribute('aria-label', desired);
    if (element.getAttribute('title') !== desired) element.setAttribute('title', desired);
  });
  applyRuntimeTranslations(root);
}

function ensureRuntimeObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || runtimeObserver) return;
  runtimeObserver = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        const name = record.attributeName;
        if (name === 'placeholder' || name === 'aria-label' || name === 'title') localizeAttribute(record.target, name);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node instanceof Text) localizeTextNode(node);
        else if (node instanceof Element) applyRuntimeTranslations(node);
      }
    }
  });
  runtimeObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['placeholder', 'aria-label', 'title'],
  });
}

export function setLocale(next: AppLocale): void {
  if (!SUPPORTED_LOCALES.includes(next)) return;
  locale = next;
  try { safeStorage()?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* optional preference */ }
  if (typeof document !== 'undefined') applyDocumentTranslations();
  listeners.forEach(listener => listener(next));
}

export function subscribeLocale(listener: (locale: AppLocale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initializeLocale(): void {
  if (typeof document === 'undefined') return;
  applyDocumentTranslations();
  ensureRuntimeObserver();
}
