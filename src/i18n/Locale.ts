export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type AppLocale = typeof SUPPORTED_LOCALES[number];
export const LOCALE_STORAGE_KEY = 'knowledge-ball.locale.v1';

const en = {
  'app.account': 'Account', 'app.settings': 'Settings', 'app.current': 'Current',
  'app.search': 'Ask a question or search knowledge…', 'app.send': 'Search',
  'app.close': 'Back to Knowledge Ball', 'app.cancel': 'Cancel', 'app.submit': 'Submit knowledge',
  'settings.title': 'Settings', 'settings.appearance': 'Knowledge node sphere',
  'settings.radius': 'Sphere radius (mm)', 'settings.labels': 'Knowledge node labels',
  'settings.fontSize': 'Font size', 'settings.color': 'Color', 'settings.font': 'Font',
  'settings.brightness': 'Brightness', 'settings.font.default': 'Default sans serif',
  'settings.font.serif': 'Serif', 'settings.font.mono': 'Monospace',
  'settings.language': 'Language', 'settings.downloads': 'Downloads',
  'settings.downloads.hint': 'Get Knowledge Ball for your platform',
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
} as const;

export type TranslationKey = keyof typeof en;
const zhCN: Record<TranslationKey, string> = {
  'app.account':'个人账户','app.settings':'设置','app.current':'当前','app.search':'输入问题，或搜索知识节点…','app.send':'搜索','app.close':'返回知识球','app.cancel':'取消','app.submit':'提交知识',
  'settings.title':'设置','settings.appearance':'知识节点球体','settings.radius':'球体半径 (mm)','settings.labels':'知识节点文字标签','settings.fontSize':'字号','settings.color':'颜色','settings.font':'字体','settings.brightness':'亮度','settings.font.default':'默认无衬线','settings.font.serif':'衬线（宋体风格）','settings.font.mono':'等宽','settings.language':'语言','settings.downloads':'下载','settings.downloads.hint':'获取适合你平台的知识球',
  'downloads.title':'下载','downloads.back':'返回设置','downloads.ios.title':'Apple / iOS','downloads.ios.meta':'版本 0.2.0 · iOS 14 及以上。使用 Safari 安装。','downloads.ios.action':'安装 iOS 应用','downloads.android.title':'Android','downloads.android.meta':'版本 0.2.0 · Android 7.0 及以上。','downloads.android.action':'下载 Android 安装包（APK）','downloads.windows.title':'Windows','downloads.windows.meta':'此仓库目前没有 Windows 安装程序。','downloads.unavailable':'暂未提供','downloads.update':'检查更新','downloads.share':'分享当前版本',
  'legend.title':'知识层级','legend.inner':'第一层 · 语义与基础事实','legend.middle':'第二层 · 严谨推理','legend.outer':'第三层 · 概率与争议','legend.help':'第一层包括静态语义关系；第二层只表达推理结构；第三层表达争议或提交时明确声明的不确定 / 概率知识。',
  'account.title':'个人账户','account.auth':'身份验证状态','account.verified':'已验证 · 凭证式','account.reputation':'声誉积分','account.lit':'已点亮知识节点','account.contributions':'本人贡献节点数',
  'create.title':'提交新知识节点','create.name':'知识标题','create.name.placeholder':'填写知识标题','create.layer':'知识层级','create.description':'知识描述','create.description.placeholder':'填写知识本身的完整描述…','create.reasoning':'推理过程','create.reasoning.placeholder':'逐步说明如何从所选前提推出该结论…','create.premises':'前置知识点（依赖边，可多选）','create.rule':'逻辑符号（推理分类）','create.rule.hint':'若该推理使用已有正式规则，可在这里标记；不作为提交门槛。','taxonomy.inner':'第一层 · 语义与基础事实','taxonomy.middle':'第二层 · 严谨推理','taxonomy.outer':'第三层 · 概率与争议',
  'mobile.offline':'当前离线 · 本地知识图谱仍可浏览','mobile.checking':'正在检查最新版…','mobile.latest':'当前已是最新版 v{version}','mobile.found':'发现 v{version}，正在打开安装页面…','mobile.updateError':'检查更新失败，请确认网络后重试。','mobile.preparing':'正在准备当前版本安装包…','mobile.shared':'安装包已交给系统分享面板。','mobile.shareError':'准备分享失败，请确认网络和存储空间后重试。','mobile.iosShared':'安装地址已交给系统分享面板。','mobile.iosShareError':'分享失败，请稍后重试。',
};
export const catalogs: Readonly<Record<AppLocale, Readonly<Record<TranslationKey, string>>>> = { 'zh-CN': zhCN, en };

function initialLocale(): AppLocale {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh-CN' || stored === 'en') return stored;
  }
  return 'zh-CN';
}
let locale = initialLocale();
const listeners = new Set<(locale: AppLocale) => void>();
export const getLocale = (): AppLocale => locale;
export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), catalogs[locale][key]);
}
export function applyDocumentTranslations(root: ParentNode = document): void {
  document.documentElement.lang = locale;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n as TranslationKey); });
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder as TranslationKey)); });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => { const value=t(el.dataset.i18nAria as TranslationKey); el.setAttribute('aria-label', value); el.setAttribute('title', value); });
}
export function setLocale(next: AppLocale): void {
  if (!SUPPORTED_LOCALES.includes(next)) return;
  locale = next; localStorage.setItem(LOCALE_STORAGE_KEY, next); applyDocumentTranslations(); listeners.forEach(listener => listener(next));
}
export function subscribeLocale(listener: (locale: AppLocale) => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function initializeLocale(): void { applyDocumentTranslations(); }
