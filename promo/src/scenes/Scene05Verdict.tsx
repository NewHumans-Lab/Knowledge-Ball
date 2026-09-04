import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const checks = [
  "REFERENCE INTEGRITY",
  "LEGAL RELATIONS",
  "CYCLE SAFETY",
  "DUPLICATE RISK",
  "SEMANTIC CHANGE",
];

export const Scene05Verdict: React.FC<{ scene: StoryScene; index: number }> = ({
  scene,
  index,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const vertical = height > width;
  const support = interpolate(frame, [2 * fps, 10 * fps], [12, 68], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const oppose = interpolate(frame, [4 * fps, 10 * fps], [9, 32], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          top: vertical ? 165 : 125,
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
        accent={COLORS.cyan}
        delay={12}
        style={{
          position: "absolute",
          left: vertical ? 60 : 1010,
          right: vertical ? 60 : 105,
          top: vertical ? 625 : 128,
          padding: vertical ? 34 : 36,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <MiniBadge>CLAIM VERSION · v2</MiniBadge>
          <span style={{ color: COLORS.muted, fontSize: vertical ? 18 : 16 }}>
            ID KB-1842
          </span>
        </div>
        <div
          style={{
            fontSize: vertical ? 34 : 32,
            lineHeight: 1.25,
            fontWeight: 800,
            marginTop: 25,
          }}
        >
          “The current conclusion follows under evidence set E₂.”
        </div>
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 27 }}
        >
          {checks.map((check) => (
            <div
              key={check}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                color: "#CFE9DF",
                border: "1px solid rgba(83,227,166,.25)",
                background: "rgba(83,227,166,.07)",
                borderRadius: 12,
                padding: "9px 11px",
                fontSize: vertical ? 16 : 13,
                fontWeight: 800,
                letterSpacing: 0.7,
              }}
            >
              <span style={{ color: COLORS.green }}>✓</span>
              {check}
            </div>
          ))}
        </div>
      </GlassCard>
      <GlassCard
        accent={COLORS.violet}
        delay={26}
        style={{
          position: "absolute",
          left: vertical ? 60 : 1010,
          right: vertical ? 60 : 105,
          top: vertical ? 1030 : 545,
          padding: vertical ? 34 : 32,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <MiniBadge color={COLORS.green}>BOUNDED VERDICT</MiniBadge>
          <span
            style={{
              color: COLORS.white,
              fontSize: vertical ? 36 : 32,
              fontWeight: 900,
            }}
          >
            CURRENTLY ACCEPTED
          </span>
        </div>
        <div style={{ marginTop: 28 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 800,
              fontSize: vertical ? 18 : 16,
              marginBottom: 11,
            }}
          >
            <span style={{ color: COLORS.cyan }}>
              SUPPORT {Math.round(support)}%
            </span>
            <span style={{ color: COLORS.coral }}>
              OPPOSITION {Math.round(oppose)}%
            </span>
          </div>
          <div
            style={{
              height: 20,
              borderRadius: 999,
              background: `${COLORS.coral}AA`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${support}%`,
                background: `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.blue})`,
                boxShadow: `0 0 28px ${COLORS.cyan}`,
              }}
            />
          </div>
        </div>
        <div
          style={{
            color: COLORS.muted,
            marginTop: 24,
            fontSize: vertical ? 22 : 19,
            lineHeight: 1.35,
          }}
        >
          Known evidence + known rules · New evidence may open a new version or
          an opposing branch.
        </div>
      </GlassCard>
      <div
        style={{
          position: "absolute",
          left: vertical ? 96 : 300,
          bottom: vertical ? 405 : 205,
          color: COLORS.coral,
          fontWeight: 800,
          fontSize: vertical ? 20 : 17,
          letterSpacing: 2,
        }}
      >
        NOT ETERNAL TRUTH · NOT A POPULARITY ORACLE
      </div>
    </SceneShell>
  );
};
