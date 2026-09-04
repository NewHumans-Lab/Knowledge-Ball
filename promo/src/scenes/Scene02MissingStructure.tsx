import { useCurrentFrame, useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const fragments = [
  ["DEFINITION", "What does the term mean here?", COLORS.cyan],
  ["EVIDENCE", "Which sources are independent?", COLORS.blue],
  ["ASSUMPTION", "What must already be true?", COLORS.amber],
  ["COUNTEREXAMPLE", "Where does the claim break?", COLORS.coral],
  ["REVISION", "Why did the answer change?", COLORS.violet],
] as const;

export const Scene02MissingStructure: React.FC<{
  scene: StoryScene;
  index: number;
}> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          top: vertical ? 180 : 190,
          width: vertical ? 960 : 720,
        }}
      >
        <TitleBlock
          eyebrow={scene.eyebrow}
          title={scene.title}
          support={scene.support}
          compact={vertical}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 960,
          right: vertical ? 60 : 105,
          top: vertical ? 655 : 155,
          height: vertical ? 800 : 675,
        }}
      >
        {fragments.map(([label, copy, color], fragmentIndex) => {
          const positions = vertical
            ? [
                [0, 0],
                [410, 88],
                [65, 235],
                [455, 350],
                [80, 510],
              ]
            : [
                [25, 10],
                [390, 55],
                [80, 225],
                [445, 285],
                [190, 470],
              ];
          const [x, y] = positions[fragmentIndex];
          const drift = Math.sin(frame / 35 + fragmentIndex) * 8;
          return (
            <GlassCard
              key={label}
              accent={color}
              delay={10 + fragmentIndex * 6}
              style={{
                position: "absolute",
                left: x,
                top: y + drift,
                width: vertical ? 445 : 370,
                padding: vertical ? 28 : 24,
              }}
            >
              <MiniBadge color={color}>{label}</MiniBadge>
              <div
                style={{
                  fontSize: vertical ? 27 : 23,
                  color: COLORS.white,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  marginTop: 19,
                }}
              >
                {copy}
              </div>
            </GlassCard>
          );
        })}
        <svg
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          width="100%"
          height="100%"
        >
          <path
            d={
              vertical
                ? "M220 95 C490 170, 220 260, 550 425 S350 560, 300 640"
                : "M205 95 C420 155, 180 280, 560 335 S360 470, 345 560"
            }
            fill="none"
            stroke={COLORS.cyan}
            strokeOpacity=".2"
            strokeWidth="2"
            strokeDasharray="8 12"
          />
        </svg>
      </div>
    </SceneShell>
  );
};
