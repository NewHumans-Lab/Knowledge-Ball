import { readFile, stat } from 'node:fs/promises';

const apkPath = 'public/downloads/knowledge-ball-android-v0.1.0.apk';
const html = await readFile('index.html', 'utf8');
const apk = await readFile(apkPath);
const apkStat = await stat(apkPath);
const manifest = JSON.parse(await readFile('public/downloads/latest.json', 'utf8'));

if (!html.includes('href="./downloads/knowledge-ball-android-v0.1.0.apk"')) {
  throw new Error('The settings page does not link to the packaged Android APK.');
}
if (!html.includes('type="application/vnd.android.package-archive"')) {
  throw new Error('The Android download does not declare the APK media type.');
}
if (apk[0] !== 0x50 || apk[1] !== 0x4b) {
  throw new Error('The Android download is not a valid ZIP/APK container.');
}
if (apkStat.size < 1_000_000) {
  throw new Error(`The Android APK is unexpectedly small (${apkStat.size} bytes).`);
}
if (manifest.version !== '0.1.0' || !manifest.android.url.endsWith('/knowledge-ball-android-v0.1.0.apk')) {
  throw new Error('The update manifest does not point to the current Android APK.');
}
if (!html.includes('id="androidUpdate"') || !html.includes('id="androidShare"')) {
  throw new Error('The native settings actions are missing update or share controls.');
}

console.log(`Android download regression tests passed (${apkStat.size} bytes).`);
