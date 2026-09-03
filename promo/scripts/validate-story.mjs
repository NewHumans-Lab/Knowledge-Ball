import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  FILM_FRAMES,
  FILM_SECONDS,
  FPS,
  NARRATION_EN,
  STORY,
  STORY_DURATION_FRAMES,
} from "../src/content/story.ts";

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

assert(STORY.length === 9, `Expected 9 scenes, received ${STORY.length}`);
assert(
  FILM_SECONDS === 300,
  `Film must be exactly 300 seconds, received ${FILM_SECONDS}`,
);
assert(
  FILM_FRAMES === 9000 && STORY_DURATION_FRAMES === FILM_FRAMES,
  `Timeline must be exactly 9000 frames at ${FPS}fps`,
);
assert(
  new Set(STORY.map((scene) => scene.id)).size === STORY.length,
  "Scene IDs must be unique",
);

const words = NARRATION_EN.trim().split(/\s+/).length;
assert(
  words >= 620 && words <= 720,
  `English narration must remain in the 620–720 word range; received ${words}`,
);

const forbidden = [
  /fully decentral/i,
  /blockchain/i,
  /cryptocurrency/i,
  /guaranteed truth/i,
];
for (const pattern of forbidden)
  assert(
    !pattern.test(NARRATION_EN),
    `Narration contains disallowed claim: ${pattern}`,
  );
assert(
  /not a token launch/i.test(NARRATION_EN),
  "Energy boundary must explicitly reject token-launch framing",
);
assert(
  /not eternal truth/i.test(NARRATION_EN),
  "Verdict boundary must explicitly reject eternal-truth framing",
);
assert(
  /commercial value remains unproven/i.test(NARRATION_EN),
  "Commercial uncertainty must remain explicit",
);
assert(
  /not infrastructure proven at internet scale/i.test(NARRATION_EN),
  "Internet-scale uncertainty must remain explicit",
);
assert(
  /working prototype/i.test(NARRATION_EN),
  "Prototype status must remain explicit",
);

const root = resolve(import.meta.dirname, "..");
for (const asset of [
  "public/brand/knowledge-ball-logo.png",
  "public/brand/knowledge-ball-social-card.png",
  "public/subtitles/en.srt",
  "public/subtitles/zh.srt",
])
  assert(existsSync(resolve(root, asset)), `Missing required asset: ${asset}`);

const statuses = new Set(STORY.map((scene) => scene.status));
assert(
  statuses.has("implemented"),
  "At least one implemented-status scene is required",
);
assert(
  statuses.has("committed-design"),
  "Committed design must be labeled explicitly",
);
assert(statuses.has("roadmap"), "Validation gates must be labeled explicitly");

if (failures.length) {
  process.stderr.write(
    failures.map((failure) => `✗ ${failure}`).join("\n") + "\n",
  );
  process.exit(1);
}
process.stdout.write(
  `✓ Story audit passed: ${STORY.length} scenes · ${FILM_SECONDS}s · ${FILM_FRAMES} frames · ${words} English words\n`,
);
