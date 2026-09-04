import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { STORY } from "../src/content/story.ts";

const splitEnglish = (text) => {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  return sentences.flatMap((sentence) => {
    const words = sentence.trim().split(/\s+/);
    const groups = [];
    for (let index = 0; index < words.length; index += 8)
      groups.push(words.slice(index, index + 8).join(" "));
    return groups;
  });
};

const splitChinese = (text) =>
  (text.match(/[^。！？；]+[。！？；]?/g) ?? [text])
    .map((part) => part.trim())
    .filter(Boolean);

const stamp = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

const makeCues = (language) => {
  let offset = 0;
  const cues = [];
  for (const scene of STORY) {
    const parts =
      language === "en"
        ? splitEnglish(scene.narrationEn)
        : splitChinese(scene.narrationZh);
    const weights = parts.map((part) =>
      Math.max(
        1,
        language === "en"
          ? part.split(/\s+/).length
          : part.replace(/\s/g, "").length,
      ),
    );
    const total = weights.reduce((sum, value) => sum + value, 0);
    const usable = scene.durationSeconds - 3.2;
    let cursor = offset + 1.2;
    for (let index = 0; index < parts.length; index++) {
      const duration = (usable * weights[index]) / total;
      cues.push({ start: cursor, end: cursor + duration, text: parts[index] });
      cursor += duration;
    }
    offset += scene.durationSeconds;
  }
  return cues;
};

const root = resolve(import.meta.dirname, "..");
const output = join(root, "public", "subtitles");
mkdirSync(output, { recursive: true });
for (const language of ["en", "zh"]) {
  const srt = makeCues(language)
    .map(
      (cue, index) =>
        `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`,
    )
    .join("\n");
  writeFileSync(join(output, `${language}.srt`), srt);
}
process.stdout.write("✓ English and Chinese subtitle sidecars generated\n");
