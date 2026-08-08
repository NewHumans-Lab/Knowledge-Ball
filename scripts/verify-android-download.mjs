import { readFile, stat } from 'node:fs/promises';

const apkPath = 'public/downloads/knowledge-ball-android-v0.1.0.apk';
const html = await readFile('index.html', 'utf8');
const apk = await readFile(apkPath);
const apkStat = await stat(apkPath);

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

console.log(`Android download regression tests passed (${apkStat.size} bytes).`);
