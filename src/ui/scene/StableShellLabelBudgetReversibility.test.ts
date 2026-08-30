import { strict as assert } from 'node:assert';
import {
  STABLE_LABEL_MAX,
  STABLE_LABEL_MIN,
  selectStableShellLabels,
  type StableShellLabelCandidate,
} from './StableShellLabelBudget';

const WIDTH = 390;
const HEIGHT = 844;

const base: StableShellLabelCandidate[] = Array.from({ length: 24 }, (_, index) => ({
  id: `label-${index}`,
  x: 30 + (index % 4) * 105,
  y: 50 + Math.floor(index / 4) * 120,
  shellRadius: 1_000 - index,
}));

function signature(ids: ReadonlySet<string>): string {
  return [...ids].sort().join('|');
}

const initial = selectStableShellLabels(base, new Set(), WIDTH, HEIGHT);
assert.equal(initial.size, STABLE_LABEL_MAX, 'current frame must fill the 18-label budget when at least 18 candidates are eligible');
for (let index = 0; index < STABLE_LABEL_MAX; index += 1) {
  assert(initial.has(`label-${index}`), 'outer-shell candidates must outrank inner-shell candidates when spacing permits');
}

const zoomed: StableShellLabelCandidate[] = [
  ...base.map((candidate, index) => index < 4 ? { ...candidate, x: -40 } : candidate),
  { id: 'zoom-outer-0', x: 30, y: 50, shellRadius: 2_000 },
  { id: 'zoom-outer-1', x: 135, y: 50, shellRadius: 1_999 },
  { id: 'zoom-outer-2', x: 240, y: 50, shellRadius: 1_998 },
  { id: 'zoom-outer-3', x: 345, y: 50, shellRadius: 1_997 },
];
const zoomBudget = selectStableShellLabels(zoomed, initial, WIDTH, HEIGHT);
assert.equal(zoomBudget.size, STABLE_LABEL_MAX, 'zoomed current frame must still respect the 18-label cap');
for (let index = 0; index < 4; index += 1) {
  assert(zoomBudget.has(`zoom-outer-${index}`), 'newly eligible higher-priority outer-shell labels must enter immediately');
}
assert.notEqual(signature(zoomBudget), signature(initial), 'zoom must exercise a genuinely different label set');

const zoomBack = selectStableShellLabels(base, zoomBudget, WIDTH, HEIGHT);
assert.equal(signature(zoomBack), signature(initial), 'zooming back to the identical frame must restore the identical label set');

const rotated = base.map((candidate, index) => index < 5 ? { ...candidate, x: WIDTH + 50 } : candidate);
const rotatedBudget = selectStableShellLabels(rotated, zoomBack, WIDTH, HEIGHT);
assert.notEqual(signature(rotatedBudget), signature(initial), 'rotation-style off-screen changes must update the current label set');
const rotatedBack = selectStableShellLabels(base, rotatedBudget, WIDTH, HEIGHT);
assert.equal(signature(rotatedBack), signature(initial), 'rotating back to the identical frame must restore the identical label set');

let repeated = rotatedBack;
for (let index = 0; index < 100; index += 1) {
  repeated = selectStableShellLabels(base, repeated, WIDTH, HEIGHT);
  assert.equal(signature(repeated), signature(initial), 'the same frame must be deterministic across repeated selection passes');
}

const legacySeed = new Set(Array.from({ length: 14 }, (_, index) => `label-${index + 4}`));
const legacyPass = selectStableShellLabels(base, legacySeed, WIDTH, HEIGHT);
assert.equal(signature(legacyPass), signature(legacySeed), 'an externally seeded legacy 12..18 set may be retained for one compatibility pass');
const legacyFeedback = selectStableShellLabels(base, legacyPass, WIDTH, HEIGHT);
assert.equal(signature(legacyFeedback), signature(initial), 'once a selector-produced budget is fed back, current-frame authority must replace legacy retention');

const whitelistFixture: StableShellLabelCandidate[] = [
  ...base,
  { id: 'n1', x: 170, y: 390, shellRadius: 3 },
  { id: 'n2', x: 195, y: 420, shellRadius: 3 },
  { id: 'n16', x: 220, y: 390, shellRadius: 3 },
];
const whitelistBudget = selectStableShellLabels(whitelistFixture, repeated, WIDTH, HEIGHT);
assert.equal(whitelistBudget.size, STABLE_LABEL_MAX, 'core whitelist must stay inside the normal 18-label cap');
for (const id of ['n1', 'n2', 'n16']) assert(whitelistBudget.has(id), `${id} must survive whenever it is eligible`);
assert(whitelistBudget.size >= STABLE_LABEL_MIN && whitelistBudget.size <= STABLE_LABEL_MAX, 'large-mobile label count must remain inside the intended 12..18 band');

console.log('Stable shell label zoom/rotation reversibility tests passed');
