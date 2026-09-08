import { readFileSync, writeFileSync } from 'node:fs';

const runtimePath = 'src/ui/voice/VoiceRoomRuntime.ts';

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`Unable to locate ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`Expected unique ${label}`);
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

let runtime = readFileSync(runtimePath, 'utf8');

runtime = replaceOnce(
  runtime,
  ".voice-node-count{position:absolute;left:24px;top:50%;transform:translateY(-50%);min-width:14px;padding:2px 4px;border-radius:8px;",
  ".voice-node-count{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:14px;padding:2px 4px;border-radius:8px;",
  'desktop voice count side offset',
);

runtime = replaceOnce(
  runtime,
  '.voice-node-count{left:22px;font-size:9px}',
  '.voice-node-count{font-size:9px}',
  'mobile voice count side offset',
);

runtime = replaceOnce(
  runtime,
  "    const debug = getDebug();\n    const wanted = wantedMarkerIds();\n    syncDetailVoiceButton();",
  "    const debug = getDebug();\n    const wanted = wantedMarkerIds();\n    const layerRect = layer.getBoundingClientRect();\n    syncDetailVoiceButton();",
  'voice marker layer coordinate origin',
);

runtime = replaceOnce(
  runtime,
  "      if (point) {\n        marker.style.left = `${point.x}px`;\n        marker.style.top = `${point.y}px`;\n      }",
  "      if (point) {\n        marker.style.left = `${point.x - layerRect.left}px`;\n        marker.style.top = `${point.y - layerRect.top}px`;\n      }",
  'voice marker viewport-to-layer conversion',
);

if (!runtime.includes('.voice-node-count{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)')) {
  throw new Error('Voice room count is not centered in the marker');
}
if (runtime.includes('.voice-node-count{left:22px')) {
  throw new Error('Mobile side offset still exists');
}
if (!runtime.includes('marker.style.left = `${point.x - layerRect.left}px`;')) {
  throw new Error('Voice marker x coordinate is not layer-local');
}
if (!runtime.includes('marker.style.top = `${point.y - layerRect.top}px`;')) {
  throw new Error('Voice marker y coordinate is not layer-local');
}

writeFileSync(runtimePath, runtime);
