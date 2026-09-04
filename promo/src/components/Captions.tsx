import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { StoryScene } from "../content/story";
import { COLORS, FONT_SANS } from "../theme";

const splitEnglish = (text: string): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const phrases: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    for (let index = 0; index < words.length; index += 8) {
      phrases.push(words.slice(index, index + 8).join(" "));
    }
  }
  return phrases;
};

const splitChinese = (text: string): string[] =>
  (text.match(/[^。！？；]+[。！？；]?/g) ?? [text])
    .map((part) => part.trim())
    .filter(Boolean);

const weightedIndex = (parts: readonly string[], progress: number) => {
  const weights = parts.map((part) =>
    Math.max(1, part.replace(/\s/g, "").length),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  const cursor = progress * total;
  let cumulative = 0;
  for (let index = 0; index < parts.length; index++) {
    cumulative += weights[index];
    if (cursor <= cumulative) return index;
  }
  return Math.max(0, parts.length - 1);
};

export const Captions: React.FC<{ scene: StoryScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const start = 1.2 * fps;
  const end = (scene.durationSeconds - 2) * fps;
  const progress = interpolate(frame, [start, end], [0, 0.9999], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const english = splitEnglish(scene.narrationEn);
  const chinese = splitChinese(scene.narrationZh);
  const enIndex = weightedIndex(english, progress);
  const zhIndex = weightedIndex(chinese, progress);
  const visible = interpolate(
    frame,
    [start - 5, start + 4, end - 5, end + 5],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        position: "absolute",
        left: vertical ? 54 : 150,
        right: vertical ? 54 : 150,
        bottom: vertical ? 116 : 58,
        display: "flex",
        justifyContent: "center",
        opacity: visible,
        zIndex: 20,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: vertical ? 950 : 1520,
          borderRadius: vertical ? 28 : 22,
          padding: vertical ? "20px 28px 22px" : "15px 30px 17px",
          background:
            "linear-gradient(180deg, rgba(3,5,18,.64), rgba(3,5,18,.88))",
          boxShadow: "0 16px 60px rgba(0,0,0,.35)",
          backdropFilter: "blur(18px)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: COLORS.white,
            fontFamily: FONT_SANS,
            fontSize: vertical ? 37 : 32,
            fontWeight: 700,
            lineHeight: 1.22,
            letterSpacing: -0.45,
          }}
        >
          {english[enIndex]}
        </div>
        <div
          style={{
            color: "#C8D3F1",
            fontFamily: '"Noto Sans CJK SC", "Noto Sans SC", Arial, sans-serif',
            fontSize: vertical ? 29 : 24,
            fontWeight: 500,
            lineHeight: 1.26,
            marginTop: 8,
          }}
        >
          {chinese[zhIndex]}
        </div>
      </div>
    </div>
  );
};
