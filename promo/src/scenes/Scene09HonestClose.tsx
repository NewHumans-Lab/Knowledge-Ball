import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { KnowledgeOrb } from "../components/KnowledgeOrb";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const gates = [
  ["THEORY", "COHERENT", COLORS.green],
  ["ENGINEERING", "MODERATE", COLORS.amber],
  ["COMMERCIAL", "UNPROVEN", COLORS.coral],
  ["INTERNET SCALE", "NOT PROVEN", COLORS.violet],
] as const;

export const Scene09HonestClose: React.FC<{
  scene: StoryScene;
  index: number;
}> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const vertical = height > width;
  const closing = interpolate(frame, [18 * fps, 23 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          top: vertical ? 165 : 120,
          width: vertical ? 950 : 825,
          opacity: 1 - closing,
        }}
      >
        <TitleBlock
          eyebrow={scene.eyebrow}
          title="Prototype—not mythology."
          support="The product states what is coherent, what is working, and what still needs proof."
          compact={vertical}
        />
      </div>
      <GlassCard
        accent={COLORS.violet}
        delay={12}
        style={{
          position: "absolute",
          left: vertical ? 60 : 1010,
          right: vertical ? 60 : 105,
          top: vertical ? 620 : 145,
          padding: vertical ? 32 : 30,
          opacity: 1 - closing,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <MiniBadge color={COLORS.violet}>WHITE PAPER 1.0</MiniBadge>
          <span style={{ color: COLORS.muted, fontSize: vertical ? 17 : 14 }}>
            PROTOCOL-CONVERGENCE STAGE
          </span>
        </div>
        {gates.map(([label, value, color], gateIndex) => (
          <div
            key={label}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              alignItems: "center",
              minHeight: vertical ? 84 : 78,
              borderTop:
                gateIndex === 0 ? "1px solid rgba(255,255,255,.08)" : undefined,
              borderBottom: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <span
              style={{
                color: COLORS.white,
                fontSize: vertical ? 22 : 19,
                fontWeight: 800,
              }}
            >
              {label}
            </span>
            <span
              style={{
                color,
                fontSize: vertical ? 22 : 19,
                fontWeight: 900,
                letterSpacing: 1.2,
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </GlassCard>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: closing,
          transform: `scale(${0.95 + closing * 0.05})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: vertical ? 300 : 42,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <KnowledgeOrb mode="close" size={vertical ? 780 : 620} />
        </div>
        <div
          style={{
            position: "absolute",
            left: vertical ? 60 : 220,
            right: vertical ? 60 : 220,
            top: vertical ? 975 : 640,
            textAlign: "center",
          }}
        >
          <TitleBlock
            eyebrow="KNOWLEDGE BALL · NEW HUMANS"
            title={scene.title}
            support={scene.support}
            align="center"
            compact={vertical}
          />
          <div
            style={{
              color: COLORS.cyan,
              fontSize: vertical ? 21 : 18,
              letterSpacing: 3,
              fontWeight: 900,
              marginTop: 34,
            }}
          >
            INSPECT · CHALLENGE · REVISE · LEARN
          </div>
        </div>
      </div>
    </SceneShell>
  );
};
