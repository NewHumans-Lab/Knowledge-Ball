import { Capacitor } from '@capacitor/core';
import { getLocale, subscribeLocale } from '../i18n/Locale';
import type { ReleaseArtifact, ReleaseManifest } from '../release/ReleaseManifest';

const REMOTE_MANIFEST_URL = 'https://newhumans-lab.github.io/Knowledge-Ball/downloads/latest.json';

let manifest: ReleaseManifest | null = null;

function manifestUrl(): string {
  if (Capacitor.isNativePlatform()) return REMOTE_MANIFEST_URL;
  return new URL('downloads/latest.json', document.baseURI).toString();
}

async function loadManifest(): Promise<ReleaseManifest> {
  const response = await fetch(`${manifestUrl()}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Release manifest request failed (${response.status})`);
  const value = await response.json() as ReleaseManifest;
  if (value.schema !== 1 || !value.version || !value.build || !value.commit || !value.platforms) {
    throw new Error('Invalid release manifest');
  }
  return value;
}

function copy() {
  return getLocale() === 'en'
    ? {
        loading: 'Reading release status…',
        unavailable: 'Not available yet',
        androidUnavailable: 'No current Android installer is published for this build.',
        androidMeta: (version: string) => `Version ${version} · Android 7.0 or later.`,
        androidAction: 'Download Android APK',
        iosWebMeta: (version: string) => `iOS Web App · Version ${version} · Install with Safari.`,
        iosWebAction: 'Install iOS Web App',
        windowsUnavailable: 'No current Windows installer is published for this build.',
        windowsAction: 'Download Windows app',
      }
    : {
        loading: '正在读取发布状态…',
        unavailable: '暂未提供',
        androidUnavailable: '当前构建尚未发布 Android 安装包。',
        androidMeta: (version: string) => `版本 ${version} · Android 7.0 及以上。`,
        androidAction: '下载 Android 安装包（APK）',
        iosWebMeta: (version: string) => `iOS Web App · 版本 ${version} · 使用 Safari 安装。`,
        iosWebAction: '安装 iOS Web App',
        windowsUnavailable: '当前构建尚未发布 Windows 安装程序。',
        windowsAction: '下载 Windows 应用',
      };
}

function setMeta(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function configureAnchor(id: string, artifact: ReleaseArtifact, urlKey: string, label: string, unavailableLabel: string): void {
  const anchor = document.getElementById(id) as HTMLAnchorElement | null;
  if (!anchor) return;
  anchor.removeAttribute('data-i18n');
  const url = artifact.urls[urlKey];
  const enabled = artifact.available && Boolean(url);
  anchor.textContent = enabled ? label : unavailableLabel;
  anchor.classList.toggle('primary', enabled);
  anchor.setAttribute('aria-disabled', enabled ? 'false' : 'true');
  anchor.tabIndex = enabled ? 0 : -1;
  anchor.style.pointerEvents = enabled ? '' : 'none';
  if (enabled && url) {
    anchor.href = url;
    if (urlKey === 'download') {
      const filename = new URL(url).pathname.split('/').pop();
      if (filename) anchor.download = filename;
    }
  } else {
    anchor.removeAttribute('href');
    anchor.removeAttribute('download');
  }
}

function configureWindows(artifact: ReleaseArtifact, label: string, unavailableLabel: string): void {
  const button = document.getElementById('windowsDownload') as HTMLButtonElement | null;
  if (!button) return;
  button.removeAttribute('data-i18n');
  const url = artifact.urls.installer ?? artifact.urls.portable;
  const enabled = artifact.available && Boolean(url);
  button.disabled = !enabled;
  button.textContent = enabled ? label : unavailableLabel;
  button.onclick = enabled && url ? () => { window.location.href = url; } : null;
}

function render(): void {
  const text = copy();
  if (!manifest) {
    setMeta('iosDownloadMeta', text.loading);
    setMeta('androidDownloadMeta', text.loading);
    setMeta('windowsDownloadMeta', text.loading);
    return;
  }

  const iosWeb = manifest.platforms.iosWeb;
  const android = manifest.platforms.android;
  const windows = manifest.platforms.windows;

  setMeta('iosDownloadMeta', iosWeb.available && iosWeb.version ? text.iosWebMeta(iosWeb.version) : text.unavailable);
  configureAnchor('iosDownload', iosWeb, 'install', text.iosWebAction, text.unavailable);

  setMeta('androidDownloadMeta', android.available && android.version ? text.androidMeta(android.version) : text.androidUnavailable);
  configureAnchor('androidDownload', android, 'download', text.androidAction, text.unavailable);

  setMeta('windowsDownloadMeta', windows.available ? text.windowsAction : text.windowsUnavailable);
  configureWindows(windows, text.windowsAction, text.unavailable);
}

export async function installReleaseDownloads(): Promise<void> {
  render();
  subscribeLocale(render);
  try {
    manifest = await loadManifest();
  } catch (error) {
    console.warn('[Knowledge-Ball] release manifest unavailable:', error);
    manifest = null;
  }
  render();
}

void installReleaseDownloads();
