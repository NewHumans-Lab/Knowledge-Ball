import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { AppLocale } from '../i18n/Locale';

const PUBLISHED_ROOT = 'https://newhumans-lab.github.io/Knowledge-Ball/whitepapers/';

export function whitePaperFilename(locale: AppLocale): string {
  return locale === 'en'
    ? 'Knowledge-Ball-White-Paper-EN.pdf'
    : 'Knowledge-Ball-White-Paper-ZH.pdf';
}

export function whitePaperUrl(locale: AppLocale, native: boolean, baseUri: string): string {
  const filename = whitePaperFilename(locale);
  return native
    ? new URL(filename, PUBLISHED_ROOT).toString()
    : new URL(`whitepapers/${filename}`, baseUri).toString();
}

export async function openWhitePaper(locale: AppLocale): Promise<void> {
  const native = Capacitor.isNativePlatform();
  const url = whitePaperUrl(locale, native, document.baseURI);
  if (native) {
    await Browser.open({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
