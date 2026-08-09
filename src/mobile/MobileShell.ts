import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

export const CURRENT_APP_VERSION = '0.1.0';
export const DOWNLOAD_ROOT = 'https://rushow111.github.io/Knowledge-Ball/downloads';
export const CURRENT_APK_URL = `${DOWNLOAD_ROOT}/knowledge-ball-android-v${CURRENT_APP_VERSION}.apk`;
export const UPDATE_MANIFEST_URL = `${DOWNLOAD_ROOT}/latest.json`;
export const IOS_INSTALL_URL = 'https://rushow111.github.io/Knowledge-Ball/ios-install.html';

interface UpdateManifest {
  version: string;
  android: { url: string };
  ios: { url: string };
}

export type BackAction = 'close-overlay' | 'close-panel' | 'exit';

export function chooseBackAction(overlayOpen: boolean, panelOpen: boolean): BackAction {
  if (overlayOpen) return 'close-overlay';
  if (panelOpen) return 'close-panel';
  return 'exit';
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const normalize = (version: string) => version.split('.').map(part => Number.parseInt(part, 10) || 0);
  const next = normalize(candidate);
  const installed = normalize(current);
  for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
    if ((next[index] ?? 0) !== (installed[index] ?? 0)) return (next[index] ?? 0) > (installed[index] ?? 0);
  }
  return false;
}

function setActionStatus(platform: 'android' | 'ios', message: string): void {
  const status = document.getElementById(`${platform}ActionStatus`);
  if (status) status.textContent = message;
}

async function loadUpdateManifest(): Promise<UpdateManifest> {
  const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Update manifest request failed (${response.status})`);
  const manifest = await response.json() as UpdateManifest;
  if (!manifest.version || !manifest.android?.url?.startsWith('https://') || !manifest.ios?.url?.startsWith('https://')) {
    throw new Error('Invalid update manifest');
  }
  return manifest;
}

async function checkForUpdate(): Promise<void> {
  const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  setActionStatus(platform, '正在检查最新版…');
  try {
    const manifest = await loadUpdateManifest();
    if (!isNewerVersion(manifest.version, CURRENT_APP_VERSION)) {
      setActionStatus(platform, `当前已是最新版 v${CURRENT_APP_VERSION}`);
      return;
    }
    setActionStatus(platform, `发现 v${manifest.version}，正在打开安装页面…`);
    await Browser.open({ url: platform === 'ios' ? manifest.ios.url : manifest.android.url });
  } catch (error) {
    console.error('Unable to check for Android updates', error);
    setActionStatus(platform, '检查更新失败，请确认网络后重试。');
  }
}

async function shareCurrentApk(): Promise<void> {
  setActionStatus('android', '正在准备当前版本安装包…');
  try {
    const response = await fetch(CURRENT_APK_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`APK download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const fileName = `knowledge-ball-android-v${CURRENT_APP_VERSION}.apk`;
    await Filesystem.writeFile({ path: fileName, directory: Directory.Cache, data: btoa(binary) });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
    await Share.share({
      title: `知识球 Android v${CURRENT_APP_VERSION}`,
      text: `知识球 Android 当前版本 v${CURRENT_APP_VERSION}`,
      files: [uri],
      dialogTitle: '分享知识球安装包',
    });
    setActionStatus('android', '安装包已交给系统分享面板。');
  } catch (error) {
    console.error('Unable to share the current Android APK', error);
    setActionStatus('android', '准备分享失败，请确认网络和存储空间后重试。');
  }
}

async function shareIosVersion(): Promise<void> {
  try {
    await Share.share({
      title: `知识球 iOS v${CURRENT_APP_VERSION}`,
      text: `知识球 iOS 当前版本 v${CURRENT_APP_VERSION}，使用 Safari 打开即可安装。`,
      url: IOS_INSTALL_URL,
      dialogTitle: '分享知识球 iOS 应用',
    });
    setActionStatus('ios', '安装地址已交给系统分享面板。');
  } catch (error) {
    console.error('Unable to share the current iOS version', error);
    setActionStatus('ios', '分享失败，请稍后重试。');
  }
}

function setupVersionActions(): void {
  document.getElementById('androidUpdate')?.addEventListener('click', () => void checkForUpdate());
  document.getElementById('androidShare')?.addEventListener('click', () => void shareCurrentApk());
  document.getElementById('iosUpdate')?.addEventListener('click', () => void checkForUpdate());
  document.getElementById('iosShare')?.addEventListener('click', () => void shareIosVersion());
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
    banner.textContent = '当前离线 · 本地知识图谱仍可浏览';
    banner.setAttribute('role', 'status');
    document.body.appendChild(banner);
  }
  banner.hidden = connected;
}

export async function setupMobileShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native-app');
  document.documentElement.classList.add(Capacitor.getPlatform());
  setupVersionActions();
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: '#080c16' });
  showNetworkState((await Network.getStatus()).connected);
  await Network.addListener('networkStatusChange', status => showNetworkState(status.connected));
  await App.addListener('backButton', async () => {
    if (closeTopLayer() === 'exit') await App.exitApp();
  });
}
