#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p public/audio

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=55:sample_rate=48000:duration=300" \
  -f lavfi -i "sine=frequency=82.41:sample_rate=48000:duration=300" \
  -f lavfi -i "sine=frequency=110:sample_rate=48000:duration=300" \
  -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=300" \
  -filter_complex "[0:a]volume=0.045[a0];[1:a]volume=0.022[a1];[2:a]volume=0.012[a2];[3:a]lowpass=f=420,highpass=f=80,volume=0.012[a3];[a0][a1][a2][a3]amix=inputs=4:normalize=0,aecho=0.8:0.62:900:0.17,afade=t=in:st=0:d=4,afade=t=out:st=294:d=6,loudnorm=I=-28:LRA=5:TP=-4[out]" \
  -map "[out]" -ar 48000 -ac 2 -codec:a libmp3lame -b:a 192k public/audio/ambient-bed.mp3

if [[ ! -s public/audio/narration-en.mp3 ]]; then
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anullsrc=r=48000:cl=stereo" -t 300 -codec:a libmp3lame -b:a 64k public/audio/narration-en.mp3
fi

echo "✓ Ambient bed and local narration placeholder ready"
