import { existsSync, readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(`Brand asset verification failed: ${message}`);
}

function pngInfo(file) {
  assert(existsSync(file), `missing ${file}`);
  const bytes = readFileSync(file);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not a PNG`);
  assert(bytes.subarray(12, 16).toString('ascii') === 'IHDR', `${file} has no IHDR header`);
  const colorType = bytes[25];
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colorType === 4 || colorType === 6 || bytes.includes(Buffer.from('tRNS')),
  };
}

function verifyPng(file, width, height, alpha) {
  const info = pngInfo(file);
  assert(info.width === width && info.height === height, `${file} must be ${width}x${height}, got ${info.width}x${info.height}`);
  if (alpha === true) assert(info.hasAlpha, `${file} must preserve transparency`);
  if (alpha === false) assert(!info.hasAlpha, `${file} must be opaque`);
}

function icoSizes(file) {
  assert(existsSync(file), `missing ${file}`);
  const bytes = readFileSync(file);
  assert(bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1, `${file} is not an ICO`);
  const count = bytes.readUInt16LE(4);
  assert(bytes.length >= 6 + count * 16, `${file} has a truncated directory`);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return [bytes[offset] || 256, bytes[offset + 1] || 256];
  });
}

function verifyIco(file, requiredSizes) {
  const dimensions = new Set(icoSizes(file).map(([width, height]) => `${width}x${height}`));
  for (const size of requiredSizes) assert(dimensions.has(`${size}x${size}`), `${file} is missing ${size}x${size}`);
}

function text(file) {
  assert(existsSync(file), `missing ${file}`);
  return readFileSync(file, 'utf8');
}

verifyPng('public/brand/knowledge-ball-logo.png', 1024, 1024, true);
verifyPng('src/assets/knowledge-ball-logo.png', 1024, 1024, true);
verifyPng('public/brand/knowledge-ball-social-card.png', 1200, 630);
verifyPng('public/icons/icon-192.png', 192, 192, false);
verifyPng('public/icons/icon-512.png', 512, 512, false);
verifyPng('public/icons/icon-maskable-512.png', 512, 512, false);
verifyPng('public/apple-touch-icon.png', 180, 180, false);
verifyPng('public/favicon-16x16.png', 16, 16, false);
verifyPng('public/favicon-32x32.png', 32, 32, false);
verifyIco('public/favicon.ico', [16, 32, 48, 64, 128, 256]);

verifyPng('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024, 1024, false);
const iosSplashes = [
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png',
  'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png',
];
for (const file of iosSplashes) verifyPng(file, 2732, 2732, false);

const androidLauncherSizes = {
  mdpi: [48, 108],
  hdpi: [72, 162],
  xhdpi: [96, 216],
  xxhdpi: [144, 324],
  xxxhdpi: [192, 432],
};
for (const [density, [launcherSize, foregroundSize]] of Object.entries(androidLauncherSizes)) {
  const root = `android/app/src/main/res/mipmap-${density}`;
  verifyPng(`${root}/ic_launcher.png`, launcherSize, launcherSize, false);
  verifyPng(`${root}/ic_launcher_round.png`, launcherSize, launcherSize, true);
  verifyPng(`${root}/ic_launcher_foreground.png`, foregroundSize, foregroundSize, true);
}

const androidSplashes = {
  'android/app/src/main/res/drawable/splash.png': [480, 320],
  'android/app/src/main/res/drawable-land-mdpi/splash.png': [480, 320],
  'android/app/src/main/res/drawable-land-hdpi/splash.png': [800, 480],
  'android/app/src/main/res/drawable-land-xhdpi/splash.png': [1280, 720],
  'android/app/src/main/res/drawable-land-xxhdpi/splash.png': [1600, 960],
  'android/app/src/main/res/drawable-land-xxxhdpi/splash.png': [1920, 1280],
  'android/app/src/main/res/drawable-port-mdpi/splash.png': [320, 480],
  'android/app/src/main/res/drawable-port-hdpi/splash.png': [480, 800],
  'android/app/src/main/res/drawable-port-xhdpi/splash.png': [720, 1280],
  'android/app/src/main/res/drawable-port-xxhdpi/splash.png': [960, 1600],
  'android/app/src/main/res/drawable-port-xxxhdpi/splash.png': [1280, 1920],
};
for (const [file, [width, height]] of Object.entries(androidSplashes)) verifyPng(file, width, height, false);

verifyPng('windows/assets/icon.png', 512, 512, false);
verifyIco('windows/assets/icon.ico', [16, 32, 48, 64, 128, 256]);

const homepage = text('index.html');
assert(homepage.includes('data-brand-logo'), 'homepage account launcher must start with the brand logo for guests');
assert(homepage.includes('/src/assets/knowledge-ball-logo.png'), 'homepage must render the bundled canonical logo');
assert(homepage.includes('./favicon.ico') && homepage.includes('./apple-touch-icon.png'), 'homepage icon links are incomplete');
assert(!homepage.includes('>RS</'), 'legacy initials still appear in the homepage launcher');

const manifest = JSON.parse(text('public/manifest.webmanifest'));
assert(manifest.background_color === '#02030a' && manifest.theme_color === '#02030a', 'web manifest theme must use the brand background');
assert(manifest.icons?.some(icon => icon.src === './icons/icon-192.png' && icon.sizes === '192x192'), 'web manifest is missing the 192px icon');
assert(manifest.icons?.some(icon => icon.src === './icons/icon-512.png' && icon.sizes === '512x512'), 'web manifest is missing the 512px icon');
assert(manifest.icons?.some(icon => icon.src === './icons/icon-maskable-512.png' && icon.purpose === 'maskable'), 'web manifest is missing the maskable icon');

const accountUi = text('src/ui/AccountUi.ts');
assert(accountUi.includes("avatar.setAttribute('data-brand-logo', '')"), 'guest account state must restore the brand logo');
assert(accountUi.includes("avatar.removeAttribute('data-brand-logo')"), 'registered account state must be allowed to replace the brand logo with the user avatar');

const launcherBackground = text('android/app/src/main/res/values/ic_launcher_background.xml');
const androidStyles = text('android/app/src/main/res/values/styles.xml');
assert(launcherBackground.includes('#02030A'), 'Android launcher background must use the brand background');
assert(androidStyles.includes('@mipmap/ic_launcher_foreground') && androidStyles.includes('@style/AppTheme.NoActionBar'), 'Android 12 splash branding is incomplete');
assert(!existsSync('android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml'), 'legacy Android robot foreground must be removed');
assert(!existsSync('android/app/src/main/res/drawable/ic_launcher_background.xml'), 'legacy Android grid background must be removed');

const windowsPackage = JSON.parse(text('windows/package.json'));
assert(windowsPackage.build?.win?.icon === 'assets/icon.ico', 'Windows installer icon is not configured');
assert(windowsPackage.build?.files?.includes('assets/icon.png'), 'Windows runtime icon is not packaged');
assert(text('windows/main.cjs').includes("path.join(__dirname, 'assets', 'icon.png')"), 'Windows window icon is not configured');

console.log('Brand asset verification passed.');