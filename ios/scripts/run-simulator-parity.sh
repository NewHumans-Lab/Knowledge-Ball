#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p artifacts/ios
npm ci
CAPACITOR_BUILD=true npm run build
npm test
npm run test:i18n
npm run test:browser-mobile
npx cap sync ios
node ios/scripts/verify-packaged-assets.mjs
(
  cd ios/App
  xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
  xcodebuild test -workspace App.xcworkspace -scheme App \
    -destination 'platform=iOS Simulator,name=iPhone 16,OS=latest' \
    -resultBundlePath ../../artifacts/ios/AppUITests.xcresult | tee ../../artifacts/ios/xcode-ui-test.log
)
DEVICE_ID=$(xcrun simctl list devices booted -j | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; print(next(x['udid'] for v in d.values() for x in v if x['state']=='Booted'))")
xcrun simctl launch "$DEVICE_ID" org.knowledgeball.app
sleep 8
xcrun simctl io "$DEVICE_ID" screenshot artifacts/ios/ios-simulator.png
(npm run preview -- --host 127.0.0.1 > artifacts/ios/vite-preview.log 2>&1 & echo $! > artifacts/ios/vite.pid)
trap 'kill $(cat artifacts/ios/vite.pid) 2>/dev/null || true' EXIT
sleep 3
node ios/scripts/capture-web-baseline.mjs
python3 -m pip install --quiet Pillow
python3 ios/scripts/compare-screenshots.py artifacts/ios/web-baseline.png artifacts/ios/ios-simulator.png
