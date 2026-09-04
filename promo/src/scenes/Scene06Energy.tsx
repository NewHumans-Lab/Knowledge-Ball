import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const entries = [
  ["SUBMIT CANDIDATE", "−1.000000", "+1.000000"],
  ["SUPPORT VERSION", "−1.000000", "+1.000000"],
  ["OPPOSE VERSION", "−1.000000", "+1.000000"],
];

export const Scene06Energy: React.FC<{ scene: StoryScene; index: number }> = ({
  scene,
  index,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const vertical = height > width;
  const counter = interpolate(frame, [4 * fps, 9 * fps], [3, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          top: vertical ? 165 : 130,
          width: vertical ? 950 : 790,
        }}
      >
        <TitleBlock
          eyebrow={scene.eyebrow}
          title={scene.title}
          support={scene.support}
          compact={vertical}
        />
      </div>
      <GlassCard
        accent={COLORS.blue}
        delay={12}
        style={{
          position: "absolute",
          left: vertical ? 60 : 990,
          right: vertical ? 60 : 105,
          top: vertical ? 630 : 125,
          padding: vertical ? 38 : 36,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 25,
          }}
        >
          <MiniBadge color={COLORS.blue}>AUTHORITATIVE LEDGER</MiniBadge>
          <span style={{ color: COLORS.muted, fontSize: vertical ? 18 : 15 }}>
            PRECISION · 0.000001
          </span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr .8fr .8fr",
            color: COLORS.muted,
            fontSize: vertical ? 16 : 13,
            letterSpacing: 1.4,
            fontWeight: 800,
            paddingBottom: 12,
            borderBottom: "1px solid rgba(255,255,255,.1)",
          }}
        >
          <span>ACTION</span>
          <span>ACCOUNT</span>
          <span>ESCROW</span>
        </div>
        {entries.map(([action, debit, credit]) => (
          <div
            key={action}
            style={{
              display: "grid",
              gridTemplateColumns: "1.5fr .8fr .8fr",
              alignItems: "center",
              minHeight: vertical ? 91 : 82,
              borderBottom: "1px solid rgba(255,255,255,.07)",
              fontSize: vertical ? 22 : 19,
            }}
          >
            <span style={{ fontWeight: 800 }}>{action}</span>
            <span style={{ color: COLORS.coral }}>{debit}</span>
            <span style={{ color: COLORS.green }}>{credit}</span>
          </div>
        ))}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 26,
          }}
        >
          <span style={{ color: COLORS.muted, fontSize: vertical ? 21 : 18 }}>
            GLOBAL NET ENERGY
          </span>
          <span
            style={{
              fontSize: vertical ? 56 : 50,
              color: COLORS.white,
              fontWeight: 900,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {counter.toFixed(6)}
          </span>
        </div>
      </GlassCard>
      <div
        style={{
          position: "absolute",
          left: vertical ? 80 : 250,
          bottom: vertical ? 405 : 198,
          display: "flex",
          gap: 18,
          alignItems: "center",
          color: COLORS.amber,
          fontSize: vertical ? 20 : 17,
          fontWeight: 800,
          letterSpacing: 1.7,
        }}
      >
        <span style={{ fontSize: vertical ? 31 : 26 }}>∅</span> NO TOKEN LAUNCH
        · NO EXTERNAL FINANCIAL VALUE
      </div>
    </SceneShell>
  );
};
