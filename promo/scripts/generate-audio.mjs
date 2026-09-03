import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { STORY } from "../src/content/story.ts";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "public", "audio");
mkdirSync(outputDirectory, { recursive: true });
const temporaryDirectory = mkdtempSync(join(tmpdir(), "knowledge-ball-voice-"));
const voice = process.env.KNOWLEDGE_BALL_VOICE || "en-US-GuyNeural";
const rate = process.env.KNOWLEDGE_BALL_VOICE_RATE || "-15%";

const run = (command, args) => {
  process.stdout.write(
    `→ ${command} ${args.filter((value) => value.length < 80).join(" ")}\n`,
  );
  execFileSync(command, args, { stdio: "inherit" });
};

const durationOf = (file) =>
  Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8" },
    ).trim(),
  );

const atempo = (ratio) => {
  const filters = [];
  let remaining = ratio;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(6)}`);
  return filters.join(",");
};

const sceneFiles = [];
for (const [index, scene] of STORY.entries()) {
  const raw = join(
    temporaryDirectory,
    `${String(index + 1).padStart(2, "0")}-raw.mp3`,
  );
  const fitted = join(
    temporaryDirectory,
    `${String(index + 1).padStart(2, "0")}-fitted.mp3`,
  );
  run("edge-tts", [
    "--voice",
    voice,
    `--rate=${rate}`,
    "--text",
    scene.narrationEn,
    "--write-media",
    raw,
  ]);
  const sourceDuration = durationOf(raw);
  const leadSeconds = 1.2;
  const tailSeconds = 2;
  const targetSpeechDuration =
    scene.durationSeconds - leadSeconds - tailSeconds;
  const tempoRatio = sourceDuration / targetSpeechDuration;
  if (tempoRatio < 0.5 || tempoRatio > 2) {
    throw new Error(
      `Scene ${scene.id} requires unsafe time stretch ${tempoRatio.toFixed(3)}x`,
    );
  }
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    raw,
    "-af",
    `${atempo(tempoRatio)},loudnorm=I=-16:LRA=7:TP=-1.5,adelay=${Math.round(leadSeconds * 1000)}:all=1,apad=whole_dur=${scene.durationSeconds}`,
    "-t",
    String(scene.durationSeconds),
    "-ar",
    "48000",
    "-ac",
    "2",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "224k",
    fitted,
  ]);
  sceneFiles.push(fitted);
}

const concatList = join(temporaryDirectory, "concat.txt");
writeFileSync(
  concatList,
  sceneFiles
    .map((file) => `file '${file.replaceAll("'", "'\\''")}'`)
    .join("\n"),
);
const combined = join(temporaryDirectory, "narration-en.mp3");
run("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  concatList,
  "-af",
  "apad=whole_dur=300",
  "-t",
  "300",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-codec:a",
  "libmp3lame",
  "-b:a",
  "224k",
  combined,
]);

const finalDuration = durationOf(combined);
if (Math.abs(finalDuration - 300) > 0.08) {
  throw new Error(
    `Narration duration ${finalDuration.toFixed(3)}s is not 300s`,
  );
}
copyFileSync(combined, join(outputDirectory, "narration-en.mp3"));
process.stdout.write(
  `✓ English browser voice: ${voice}, ${finalDuration.toFixed(3)}s\n`,
);
