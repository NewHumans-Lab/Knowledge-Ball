import { CURRENT_APP_VERSION, UPDATE_MANIFEST_URL, applyPlatformVisibility, chooseBackAction, isNewerVersion } from './MobileShell';
import { shouldOfferUpdate } from '../release/ReleaseManifest';
import packageJson from '../../package.json';

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

assertEqual(chooseBackAction(true, true), 'close-overlay');
assertEqual(chooseBackAction(false, true), 'close-panel');
assertEqual(chooseBackAction(false, false), 'exit');
assertEqual(isNewerVersion('0.1.1', '0.1.0'), true);
assertEqual(isNewerVersion('0.2.0', '0.10.0'), false);
assertEqual(isNewerVersion('1.0', '1.0.0'), false);
assertEqual(CURRENT_APP_VERSION, packageJson.version);
assertEqual(UPDATE_MANIFEST_URL.endsWith('/latest.json'), true);

assertEqual(shouldOfferUpdate('1.1.0', '1.0.0', 'remote', 'current'), true);
assertEqual(shouldOfferUpdate('1.0.0', '1.0.0', 'remote', 'current'), true);
assertEqual(shouldOfferUpdate('1.0.0', '1.0.0', 'same', 'same'), false);
assertEqual(shouldOfferUpdate('0.9.9', '1.0.0', 'remote-new-build', 'current-build'), false);

const classes = new Set<string>();
const webDownload = { hidden: false };
const androidActions = { hidden: true };
const iosActions = { hidden: true };
const androidCard = { hidden: false };
const iosCard = { hidden: false };
const windowsCard = { hidden: false };
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { classList: { add: (...names: string[]) => names.forEach(name => classes.add(name)) } },
  querySelectorAll: (selector: string) => selector === '.web-download-action'
    ? [webDownload]
    : selector === '.native-app-actions' ? [androidActions, iosActions] : [androidCard, iosCard, windowsCard],
  querySelector: (selector: string) => selector.startsWith('.android') ? (selector.includes('actions') ? androidActions : androidCard) : null,
};
applyPlatformVisibility('android');
assertEqual(classes.has('native-app'), true);
assertEqual(classes.has('android'), true);
assertEqual(webDownload.hidden, true);
assertEqual(androidCard.hidden, false);
assertEqual(iosCard.hidden, false);
assertEqual(windowsCard.hidden, false);
assertEqual(androidActions.hidden, false);
assertEqual(iosActions.hidden, true);
console.log('Mobile shell regression tests passed.');
