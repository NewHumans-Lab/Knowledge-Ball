import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { StatusBar, Style } from '@capacitor/status-bar';

export type BackAction = 'close-overlay' | 'close-panel' | 'exit';

export function chooseBackAction(overlayOpen: boolean, panelOpen: boolean): BackAction {
  if (overlayOpen) return 'close-overlay';
  if (panelOpen) return 'close-panel';
  return 'exit';
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
  await StatusBar.setStyle({ style: Style.Dark });
  await StatusBar.setBackgroundColor({ color: '#080c16' });
  showNetworkState((await Network.getStatus()).connected);
  await Network.addListener('networkStatusChange', status => showNetworkState(status.connected));
  await App.addListener('backButton', async () => {
    if (closeTopLayer() === 'exit') await App.exitApp();
  });
}
