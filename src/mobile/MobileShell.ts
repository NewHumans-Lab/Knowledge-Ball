import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';
import { subscribeLocale, t } from '../i18n/Locale';
import { compareSemanticVersions, isCurrentArtifact, shouldOfferUpdate, type ReleaseManifest } from '../release/ReleaseManifest';
import packageJson from '../../package.json';

export const CURRENT_APP_VERSION = packageJson.version;
export const CURRENT_APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'local';
export const UPDATE_MANIFEST_URL = 'https://newhumans-lab.github.io/Knowledge-Ball/downloads/latest.json';

type AndroidUpdatePlugin = {
  downloadAndInstall(options: { url: string; checksum: string; fileName: string }): Promise<{ status: string }>;
};

const AndroidUpdate = registerPlugin<AndroidUpdatePlugin>('AndroidUpdate');

export type BackAction = 'close-overlay' | 'close-panel' | 'exit';

export function chooseBackAction(overlayOpen: boolean, panelOpen: boolean): BackAction {
  if (overlayOpen) return 'close-overlay';
  if (panelOpen) return 'close-panel';
  return 'exit';
}

export function overlayCloseSelector(overlayId: string): string | null {
  switch (overlayId) {
    case 'settingsOverlay': return '#settingsClose';
    case 'accountOverlay': return '#accountClose';
    case 'downloadsOverlay': return '#downloadsClose';
    case 'modalOverlay': return '#modalClose';
    case 'knowledgeCreateOverlay': return '[data-create-close]';
    default: return null;
  }
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemanticVersions(candidate, current) > 0;
}

function setActionStatus(platform: 'android' | 'ios', message: string): void {
  const status = document.getElementById(`${platform}ActionStatus`);
  if (status) status.textContent = message;
}

async function loadUpdateManifest(): Promise<ReleaseManifest> {
  const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Update manifest request failed (${response.status})`);
  const manifest = await response.json() as ReleaseManifest;
  if (
    manifest.schema !== 1
    || !manifest.version
    || !manifest.build
    || !manifest.commit
    || !manifest.platforms?.android
    || !manifest.platforms?.ios
  ) {
    throw new Error('Invalid update manifest');
  }
  return manifest;
}

async function checkForUpdate(): Promise<void> {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  setActionStatus(platform, t('mobile.checking'));
  try {
    const manifest = await loadUpdateManifest();
    const release = manifest.platforms[platform];
    if (!release.available || !release.version || !release.build) throw new Error(`${platform} release unavailable`);

    if (!shouldOfferUpdate(release.version, CURRENT_APP_VERSION, release.build, CURRENT_APP_BUILD)) {
      setActionStatus(platform, t('mobile.latest', { version: CURRENT_APP_VERSION }));
      return;
    }

    if (platform === 'ios') {
      const url = release.urls.install;
      if (!url) throw new Error('ios release URL unavailable');
      setActionStatus(platform, t('mobile.found', { version: release.version }));
      await Browser.open({ url });
      return;
    }

    const url = release.urls.download;
    if (!url || !release.checksum || !/^sha256:[0-9a-f]{64}$/i.test(release.checksum)) {
      throw new Error('android release metadata incomplete');
    }
    const fileName = new URL(url).pathname.split('/').pop() || `knowledge-ball-android-v${release.version}-b${release.build}.apk`;
    setActionStatus(platform, t('mobile.found', { version: release.version }));
    await AndroidUpdate.downloadAndInstall({ url, checksum: release.checksum, fileName });
  } catch (error) {
    console.error('Unable to check for updates', error);
    setActionStatus(platform, t('mobile.updateError'));
  }
}

async function shareCurrentApk(): Promise<void> {
  setActionStatus('android', t('mobile.preparing'));
  try {
    const manifest = await loadUpdateManifest();
    const release = manifest.platforms.android;
    const url = release.urls.download;
    if (!isCurrentArtifact(release, CURRENT_APP_VERSION, CURRENT_APP_BUILD) || !url) {
      throw new Error('Current Android build has no matching published installer');
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`APK download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const fileName = new URL(url).pathname.split('/').pop() || `knowledge-ball-android-v${CURRENT_APP_VERSION}.apk`;
    await Filesystem.writeFile({ path: fileName, directory: Directory.Cache, data: btoa(binary) });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    await Share.share({
      title: t('mobile.androidShareTitle', { version: CURRENT_APP_VERSION }),
      text: t('mobile.androidShareText', { version: CURRENT_APP_VERSION }),
      files: [uri],
      dialogTitle: t('mobile.androidShareDialog'),
    });
    setActionStatus('android', t('mobile.shared'));
  } catch (error) {
    console.error('Unable to share the current Android APK', error);
    setActionStatus('android', t('mobile.shareError'));
  }
}

async function shareIosVersion(): Promise<void> {
  try {
    const manifest = await loadUpdateManifest();
    const release = manifest.platforms.ios;
    const url = release.urls.install;
    if (!isCurrentArtifact(release, CURRENT_APP_VERSION, CURRENT_APP_BUILD) || !url) {
      throw new Error('Current native iOS build has no matching published distribution');
    }
    await Share.share({
      title: t('mobile.iosShareTitle', { version: CURRENT_APP_VERSION }),
      text: t('mobile.iosShareText', { version: CURRENT_APP_VERSION }),
      url,
      dialogTitle: t('mobile.iosShareDialog'),
    });
    setActionStatus('ios', t('mobile.iosShared'));
  } catch (error) {
    console.error('Unable to share the current iOS version', error);
    setActionStatus('ios', t('mobile.iosShareError'));
  }
}

function setupVersionActions(): void {
  document.getElementById('androidUpdate')?.addEventListener('click', () => void checkForUpdate());
  document.getElementById('androidShare')?.addEventListener('click', () => void shareCurrentApk());
  document.getElementById('iosUpdate')?.addEventListener('click', () => void checkForUpdate());
  document.getElementById('iosShare')?.addEventListener('click', () => void shareIosVersion());
}

export function applyPlatformVisibility(platform: 'android' | 'ios'): void {
  document.documentElement.classList.add('native-app', platform);
  document.querySelectorAll<HTMLElement>('.web-download-action').forEach(element => { element.hidden = true; });
  document.querySelectorAll<HTMLElement>('.native-app-actions').forEach(element => { element.hidden = true; });
  const actions = document.querySelector<HTMLElement>(`.${platform}-native-actions`);
  if (actions) actions.hidden = false;
}

function resetNativeBackTrace(): void {
  const dataset = document.documentElement.dataset;
  dataset.nativeBackAction = '';
  dataset.nativeBackOverlay = '';
  dataset.nativeBackCloseSelector = '';
  dataset.nativeBackCloseFound = 'false';
  dataset.nativeBackCloseClicked = 'false';
}

function closeTopLayer(): BackAction {
  const overlay = document.querySelector<HTMLElement>('.knowledge-create-overlay.show')
    ?? document.querySelector<HTMLElement>('.modal-overlay.show');
  const panel = document.getElementById('panel');
  const action = chooseBackAction(Boolean(overlay), Boolean(panel?.classList.contains('open')));
  const dataset = document.documentElement.dataset;
  dataset.nativeBackAction = action;
  dataset.nativeBackOverlay = overlay?.id ?? '';

  if (action === 'close-overlay' && overlay) {
    const selector = overlayCloseSelector(overlay.id);
    dataset.nativeBackCloseSelector = selector ?? '';
    const closeControl = selector
      ? document.querySelector<HTMLElement>(selector)
      : overlay.querySelector<HTMLElement>('.panel-close');
    dataset.nativeBackCloseFound = String(Boolean(closeControl));
    if (closeControl) {
      dataset.nativeBackCloseClicked = 'true';
      closeControl.click();
    }
  }
  if (action === 'close-panel') {
    const closeControl = document.getElementById('panelClose');
    dataset.nativeBackCloseSelector = '#panelClose';
    dataset.nativeBackCloseFound = String(Boolean(closeControl));
    if (closeControl) {
      dataset.nativeBackCloseClicked = 'true';
      closeControl.click();
    }
  }
  return action;
}

function showNetworkState(connected: boolean): void {
  document.body.classList.toggle('is-offline', !connected);
  let banner = document.getElementById('networkBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'networkBanner';
    banner.className = 'network-banner';
    banner.textContent = t('mobile.offline');
    banner.setAttribute('role', 'status');
    document.body.appendChild(banner);
  }
  banner.hidden = connected;
}

async function initializeMobileShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const platform = Capacitor.getPlatform();
  if (platform !== 'android' && platform !== 'ios') return;

  applyPlatformVisibility(platform);
  setupVersionActions();

  // Back navigation is a core interaction contract. Register it before optional
  // native decoration/network setup so a rejected or slow plugin call cannot
  // leave Android with an unclosable overlay or panel.
  resetNativeBackTrace();
  document.documentElement.dataset.nativeBackCount = '0';
  await App.addListener('backButton', async () => {
    const dataset = document.documentElement.dataset;
    const currentCount = Number(dataset.nativeBackCount ?? '0');
    dataset.nativeBackCount = String(Number.isFinite(currentCount) ? currentCount + 1 : 1);
    resetNativeBackTrace();
    const action = closeTopLayer();
    if (action === 'exit') await App.exitApp();
  });
  document.documentElement.dataset.nativeBackReady = 'true';

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#080c16' });
  } catch (error) {
    console.warn('[Knowledge-Ball] Native status-bar setup failed:', error);
  }

  subscribeLocale(() => {
    const banner = document.getElementById('networkBanner');
    if (banner) banner.textContent = t('mobile.offline');
  });

  try {
    showNetworkState((await Network.getStatus()).connected);
    await Network.addListener('networkStatusChange', status => showNetworkState(status.connected));
  } catch (error) {
    console.warn('[Knowledge-Ball] Native network-state setup failed:', error);
  }
}

let mobileShellSetupPromise: Promise<void> | null = null;

export function setupMobileShell(): Promise<void> {
  mobileShellSetupPromise ??= initializeMobileShell();
  return mobileShellSetupPromise;
}

// This module is imported before the main app body executes. Start the critical
// native shell immediately so hardware Back is registered before product UI can
// become interactable. app.ts may call setupMobileShell() again safely; setup is
// idempotent and returns this same promise.
void setupMobileShell();
