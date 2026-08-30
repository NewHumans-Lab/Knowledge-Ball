import { Capacitor } from '@capacitor/core';
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
export const UPDATE_MANIFEST_URL = 'https://rushow111.github.io/Knowledge-Ball/downloads/latest.json';

export type BackAction = 'close-overlay' | 'close-panel' | 'exit';

export function chooseBackAction(overlayOpen: boolean, panelOpen: boolean): BackAction {
  if (overlayOpen) return 'close-overlay';
  if (panelOpen) return 'close-panel';
  return 'exit';
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

    const url = platform === 'ios' ? release.urls.install : release.urls.download;
    if (!url) throw new Error(`${platform} release URL unavailable`);
    setActionStatus(platform, t('mobile.found', { version: release.version }));
    await Browser.open({ url });
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

function closeTopLayer(): BackAction {
  const overlay = document.querySelector<HTMLElement>('.modal-overlay.show');
  const panel = document.getElementById('panel');
  const action = chooseBackAction(Boolean(overlay), Boolean(panel?.classList.contains('open')));
  if (action === 'close-overlay') overlay?.querySelector<HTMLButtonElement>('.panel-close')?.click();
  if (action === 'close-panel') document.getElementById('panelClose')?.click();
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

export async function setupMobileShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const platform = Capacitor.getPlatform();
  if (platform !== 'android' && platform !== 'ios') return;
  applyPlatformVisibility(platform);
  setupVersionActions();
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: '#080c16' });
  showNetworkState((await Network.getStatus()).connected);
  subscribeLocale(() => {
    const banner = document.getElementById('networkBanner');
    if (banner) banner.textContent = t('mobile.offline');
  });
  await Network.addListener('networkStatusChange', status => showNetworkState(status.connected));
  await App.addListener('backButton', async () => {
    if (closeTopLayer() === 'exit') await App.exitApp();
  });
}
