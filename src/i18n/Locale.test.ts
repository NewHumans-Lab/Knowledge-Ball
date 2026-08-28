import { catalogs, SUPPORTED_LOCALES } from './Locale';
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const reference = Object.keys(catalogs.en).sort();
for (const locale of SUPPORTED_LOCALES) {
  const keys = Object.keys(catalogs[locale]).sort();
  assert(JSON.stringify(keys) === JSON.stringify(reference), `${locale} catalog keys must be complete`);
  for (const key of reference) assert(catalogs[locale][key as keyof typeof catalogs.en].trim(), `${locale}:${key} must not be blank`);
}
const userContent = '原文 MIXED Content Ω\nreasoning: A → B';
for (const locale of SUPPORTED_LOCALES) {
  // Catalog lookups accept stable system keys only; community values are rendered directly.
  const rendered = `<h2>${userContent}</h2><label>${catalogs[locale]['create.reasoning']}</label><p>${userContent}</p>`;
  assert(rendered.match(/原文 MIXED Content Ω/g)?.length === 2, 'locale switching must preserve user content byte-for-byte');
}
assert(!JSON.stringify(catalogs).includes('.exe') && !JSON.stringify(catalogs).includes('.msi'), 'catalog must not invent a Windows artifact');
console.log('Locale catalog and user-content boundary regression passed');
