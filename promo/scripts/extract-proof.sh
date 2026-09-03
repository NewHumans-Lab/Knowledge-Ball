#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p out/proof

times=(13 41.5 74.5 109 146 182.5 215 247.5 282)
for index in "${!times[@]}"; do
  number=$(printf '%02d' "$((index + 1))")
  ffmpeg -hide_banner -loglevel error -y -ss "${times[$index]}" -i out/knowledge-ball-youtube-1080p.mp4 -frames:v 1 -vf scale=960:540 "out/proof/youtube-${number}.jpg"
  ffmpeg -hide_banner -loglevel error -y -ss "${times[$index]}" -i out/knowledge-ball-instagram-vertical.mp4 -frames:v 1 -vf scale=540:960 "out/proof/instagram-${number}.jpg"
done

echo "✓ Extracted 18 proof frames across both final masters"
