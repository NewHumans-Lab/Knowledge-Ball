import { useVideoConfig } from "remotion";
import { GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

export const Scene07TwoGraphs: React.FC<{
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
          right: vertical ? 60 : 105,
          top: vertical ? 165 : 115,
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
          left: vertical ? 60 : 125,
          right: vertical ? 60 : 125,
          top: vertical ? 680 : 530,
          display: "grid",
          gridTemplateColumns: vertical ? "1fr" : "1fr 120px 1fr",
          alignItems: "center",
          gap: vertical ? 22 : 28,
        }}
      >
        <GlassCard
          accent={COLORS.cyan}
          delay={12}
          style={{
            padding: vertical ? 34 : 38,
            minHeight: vertical ? 250 : 310,
          }}
        >
          <MiniBadge color={COLORS.cyan}>PUBLIC KNOWLEDGE</MiniBadge>
          <div
            style={{
              fontSize: vertical ? 38 : 36,
              fontWeight: 800,
              lineHeight: 1.15,
              marginTop: 25,
            }}
          >
            What does the protocol currently accept—and why?
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontSize: vertical ? 21 : 19,
              marginTop: 22,
              lineHeight: 1.45,
            }}
          >
            Version · evidence · opposition · verdict · history
          </div>
        </GlassCard>
        <div
          style={{
            height: vertical ? 5 : 280,
            width: vertical ? "100%" : 5,
            background: `linear-gradient(${vertical ? "90deg" : "180deg"}, transparent, ${COLORS.coral}, transparent)`,
            boxShadow: `0 0 30px ${COLORS.coral}`,
          }}
        />
        <GlassCard
          accent={COLORS.violet}
          delay={24}
          style={{
            padding: vertical ? 34 : 38,
            minHeight: vertical ? 250 : 310,
          }}
        >
          <MiniBadge color={COLORS.violet}>PRIVATE MASTERY</MiniBadge>
          <div
            style={{
              fontSize: vertical ? 38 : 36,
              fontWeight: 800,
              lineHeight: 1.15,
              marginTop: 25,
            }}
          >
            What have I seen, understood, saved, or hidden?
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontSize: vertical ? 21 : 19,
              marginTop: 22,
              lineHeight: 1.45,
            }}
          >
            Personal state · local progression · private visibility
          </div>
        </GlassCard>
      </div>
      <div
        style={{
          position: "absolute",
          left: vertical ? 80 : 300,
          right: vertical ? 80 : 300,
          top: vertical ? 1375 : 890,
          textAlign: "center",
          color: COLORS.coral,
          fontWeight: 900,
          letterSpacing: 2,
          fontSize: vertical ? 19 : 16,
        }}
      >
        STRICT SEPARATION · PRIVATE STATE NEVER REWRITES PUBLIC VALIDITY
      </div>
    </SceneShell>
  );
};
