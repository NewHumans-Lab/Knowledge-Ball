# Knowledge Ball — five-minute promotional film

A deterministic Remotion production with one 5:00 timeline and two native layouts:

- `KnowledgeBall-YouTube-1080p` — 1920×1080, 30 fps.
- `KnowledgeBall-Instagram-Vertical` — 1080×1920, 30 fps.

Both masters contain English browser-neural narration, burned English captions, secondary Chinese captions, and exportable English/Chinese SRT files. The layouts are authored independently at each aspect ratio; the vertical master is not a crop.

## Local preview

```bash
npm ci
npm run assets:placeholder
npm run validate
npm run lint
npm run dev
```

`assets:placeholder` creates the deterministic ambient bed and a silent five-minute narration placeholder for visual editing.

## Browser voice and final render

The release workflow installs `edge-tts`, synthesizes each scene with Microsoft Edge's `en-US-GuyNeural` browser voice, time-fits it inside that scene without changing the five-minute timeline, and normalizes narration to −16 LUFS. No API key is required.

```bash
python -m pip install edge-tts
npm run ambient
npm run subtitles
npm run audio:browser
npx remotion browser ensure
npm run render:masters
npm run verify:renders
```

Final exports use H.264 4:2:0, CRF 16, 320 kbps AAC, and 48 kHz audio. Depending on FFmpeg's range tagging, `ffprobe` may report the compatible format as `yuv420p` or `yuvj420p`. Rendered media remains outside Git; GitHub Actions publishes the two masters, proof frames, and both subtitle files as a downloadable artifact.

See [CLAIM_AUDIT.md](./CLAIM_AUDIT.md) for the white-paper consistency boundary.
