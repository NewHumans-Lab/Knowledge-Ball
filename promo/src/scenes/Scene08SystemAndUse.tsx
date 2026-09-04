import { useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const uses = [
  "LEARNING MAPS",
  "RESEARCH SYNTHESIS",
  "ORGANIZATIONAL DECISIONS",
  "STRUCTURED AI CONTEXT",
];

export const Scene08SystemAndUse: React.FC<{
  scene: StoryScene;
  index: number;
}> = ({ scene, index }) => {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          top: vertical ? 165 : 120,
          width: vertical ? 950 : 815,
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
          left: vertical ? 60 : 1010,
          right: vertical ? 60 : 105,
          top: vertical ? 630 : 125,
        }}
      >
        <GlassCard
          accent={COLORS.green}
          delay={12}
          style={{ padding: vertical ? 32 : 30 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <MiniBadge color={COLORS.green}>WORKING PROTOTYPE</MiniBadge>
            <span style={{ color: COLORS.muted, fontSize: vertical ? 17 : 14 }}>
              WEB · ANDROID · WINDOWS
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 11,
              flexWrap: "wrap",
              marginTop: 25,
            }}
          >
            {["TypeScript", "Vite", "Three.js"].map((tech) => (
              <span
                key={tech}
                style={{
                  border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: 13,
                  padding: "11px 15px",
                  color: COLORS.white,
                  fontSize: vertical ? 22 : 19,
                  fontWeight: 800,
                }}
              >
                {tech}
              </span>
            ))}
          </div>
        </GlassCard>
        <div
          style={{
            height: vertical ? 27 : 22,
            width: 3,
            margin: "0 auto",
            background: `linear-gradient(${COLORS.green}, ${COLORS.blue})`,
          }}
        />
        <GlassCard
          accent={COLORS.blue}
          delay={22}
          style={{ padding: vertical ? 32 : 30 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <MiniBadge color={COLORS.blue}>AUTHORITY BOUNDARY</MiniBadge>
            <span
              style={{
                color: COLORS.blue,
                fontSize: vertical ? 22 : 19,
                fontWeight: 900,
              }}
            >
              SERVER
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 24,
            }}
          >
            {["IDENTITY", "EVENTS", "ENERGY LEDGER", "ROW-LEVEL SECURITY"].map(
              (tech) => (
                <span
                  key={tech}
                  style={{
                    background: "rgba(52,109,255,.1)",
                    borderRadius: 10,
                    padding: "10px 13px",
                    color: "#CEDBFF",
                    fontSize: vertical ? 17 : 14,
                    fontWeight: 800,
                    letterSpacing: 0.7,
                  }}
                >
                  {tech}
                </span>
              ),
            )}
          </div>
        </GlassCard>
        <div
          style={{
            marginTop: vertical ? 26 : 20,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
          {uses.map((use, useIndex) => (
            <GlassCard
              key={use}
              accent={useIndex < 2 ? COLORS.cyan : COLORS.violet}
              delay={32 + useIndex * 5}
              style={{
                padding: vertical ? "20px 18px" : "16px 17px",
                color: COLORS.white,
                fontWeight: 800,
                fontSize: vertical ? 17 : 13,
                textAlign: "center",
                letterSpacing: 0.7,
              }}
            >
              {use}
            </GlassCard>
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: vertical ? 80 : 240,
          bottom: vertical ? 400 : 195,
          color: COLORS.muted,
          fontSize: vertical ? 20 : 17,
          fontWeight: 800,
          letterSpacing: 1.8,
        }}
      >
        MODEL PROPOSES → PERSON CONFIRMS → PROTOCOL ADMITS
      </div>
    </SceneShell>
  );
};
