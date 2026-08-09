import { CURRENT_APK_URL, IOS_INSTALL_URL, UPDATE_MANIFEST_URL, chooseBackAction, isNewerVersion } from './MobileShell';

function assertEqual(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}

assertEqual(chooseBackAction(true, true), 'close-overlay');
assertEqual(chooseBackAction(false, true), 'close-panel');
assertEqual(chooseBackAction(false, false), 'exit');
assertEqual(isNewerVersion('0.1.1', '0.1.0'), true);
assertEqual(isNewerVersion('0.2.0', '0.10.0'), false);
assertEqual(isNewerVersion('1.0', '1.0.0'), false);
assertEqual(CURRENT_APK_URL.endsWith('/knowledge-ball-android-v0.1.0.apk'), true);
assertEqual(UPDATE_MANIFEST_URL.endsWith('/latest.json'), true);
assertEqual(IOS_INSTALL_URL.endsWith('/ios-install.html'), true);
console.log('Mobile shell regression tests passed.');
