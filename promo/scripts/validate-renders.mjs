import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const expected = [
  ["out/knowledge-ball-youtube-1080p.mp4", 1920, 1080],
  ["out/knowledge-ball-instagram-vertical.mp4", 1080, 1920],
];
const errors = [];

for (const [relative, width, height] of expected) {
  const file = resolve(import.meta.dirname, "..", relative);
  if (!existsSync(file)) {
    errors.push(`${relative}: missing`);
    continue;
  }
  const data = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=index,codec_type,codec_name,width,height,pix_fmt,sample_rate,channels",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  const video = data.streams.find((stream) => stream.codec_type === "video");
  const audio = data.streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(data.format.duration);
  if (Math.abs(duration - 300) > 0.2)
    errors.push(`${relative}: duration ${duration}s, expected 300s`);
  if (!video || video.width !== width || video.height !== height)
    errors.push(`${relative}: wrong dimensions`);
  if (video?.codec_name !== "h264")
    errors.push(`${relative}: expected H.264, received ${video?.codec_name}`);
  if (video?.pix_fmt !== "yuv420p")
    errors.push(`${relative}: expected yuv420p, received ${video?.pix_fmt}`);
  if (
    !audio ||
    audio.codec_name !== "aac" ||
    Number(audio.sample_rate) !== 48000
  )
    errors.push(`${relative}: expected 48kHz AAC audio`);
  if (statSync(file).size < 12_000_000)
    errors.push(`${relative}: output is suspiciously small`);
  process.stdout.write(
    `✓ ${relative}: ${width}×${height}, ${duration.toFixed(3)}s, H.264/AAC\n`,
  );
}

if (errors.length) {
  process.stderr.write(errors.map((error) => `✗ ${error}`).join("\n") + "\n");
  process.exit(1);
}
