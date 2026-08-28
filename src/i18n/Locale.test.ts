import {
  catalogs,
  getLocale,
  legacySystemTextCatalog,
  setLocale,
  SUPPORTED_LOCALES,
  translateRuntimeSystemText,
} from './Locale';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const reference = Object.keys(catalogs.en).sort();
for (const locale of SUPPORTED_LOCALES) {
  const keys = Object.keys(catalogs[locale]).sort();
  assert(JSON.stringify(keys) === JSON.stringify(reference), `${locale} catalog keys must be complete`);
  for (const key of reference) {
    assert(catalogs[locale][key as keyof typeof catalogs.en].trim(), `${locale}:${key} must not be blank`);
  }
}

for (const [key, pair] of Object.entries(legacySystemTextCatalog)) {
  assert(pair['zh-CN'].trim(), `zh-CN:${key} must not be blank`);
  assert(pair.en.trim(), `en:${key} must not be blank`);
}

const userContent = '原文 MIXED Content Ω\nreasoning: A → B';
setLocale('en');
assert(getLocale() === 'en', 'locale source of truth must switch to English');
assert(translateRuntimeSystemText('注册 / 登录') === 'Register / Sign in', 'dynamic account UI must localize through the central runtime catalog');
assert(translateRuntimeSystemText('未找到匹配的知识节点') === 'No matching knowledge nodes found', 'dynamic search empty state must localize');
assert(translateRuntimeSystemText(userContent) === userContent, 'unknown/user-authored text must remain byte-for-byte unchanged');
assert(translateRuntimeSystemText(`节点已提交：${userContent}`) === `Node submitted: ${userContent}`, 'system wrapper may localize while preserving embedded user content exactly');

setLocale('zh-CN');
assert(getLocale() === 'zh-CN', 'locale source of truth must switch back to Chinese');
assert(translateRuntimeSystemText('Register / Sign in') === '注册 / 登录', 'dynamic system UI must switch back to Chinese');
assert(translateRuntimeSystemText(userContent) === userContent, 'user content must remain unchanged after repeated locale switching');

for (const locale of SUPPORTED_LOCALES) {
  const rendered = `<h2>${userContent}</h2><label>${catalogs[locale]['create.reasoning']}</label><p>${userContent}</p>`;
  assert(rendered.match(/原文 MIXED Content Ω/g)?.length === 2, 'locale switching must preserve user content byte-for-byte');
}

const serialized = JSON.stringify({ catalogs, legacySystemTextCatalog });
assert(!serialized.includes('.exe') && !serialized.includes('.msi'), 'localization catalogs must not invent a Windows artifact');
console.log('Locale catalog, dynamic-system-copy, and user-content boundary regressions passed');
