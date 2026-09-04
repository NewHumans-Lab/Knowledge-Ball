import { useVideoConfig } from "remotion";
import { FlowArrow, GlassCard, MiniBadge } from "../components/Primitives";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

const model = [
  {
    tag: "STABLE IDENTITY",
    name: "KnowledgeNode",
    note: "The durable subject",
    color: COLORS.cyan,
  },
  {
    tag: "IMMUTABLE ASSERTION",
    name: "ClaimVersion",
    note: "v1 → v2, never overwritten",
    color: COLORS.blue,
  },
  {
    tag: "EXPLICIT DEPENDENCY",
    name: "ReasoningNode",
    note: "premises → conclusion",
    color: COLORS.violet,
  },
];

export const Scene03NewUnit: React.FC<{ scene: StoryScene; index: number }> = ({
  scene,
  index,
}) => {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          left: vertical ? 60 : 105,
          right: vertical ? 60 : 105,
          top: vertical ? 170 : 125,
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
          left: vertical ? 60 : 135,
          right: vertical ? 60 : 135,
          top: vertical ? 690 : 530,
          display: "flex",
          flexDirection: vertical ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: vertical ? 16 : 20,
        }}
      >
        {model.map((item, modelIndex) => (
          <div key={item.name} style={{ display: "contents" }}>
            <GlassCard
              accent={item.color}
              delay={12 + modelIndex * 10}
              style={{
                padding: vertical ? "30px 34px" : "34px 30px",
                width: vertical ? 820 : 470,
                minHeight: vertical ? 150 : 235,
              }}
            >
              <MiniBadge color={item.color}>{item.tag}</MiniBadge>
              <div
                style={{
                  color: COLORS.white,
                  fontSize: vertical ? 40 : 38,
                  fontWeight: 800,
                  marginTop: 22,
                  letterSpacing: -1.5,
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  color: COLORS.muted,
                  fontSize: vertical ? 24 : 22,
                  lineHeight: 1.35,
                  marginTop: 12,
                }}
              >
                {item.note}
              </div>
            </GlassCard>
            {modelIndex < model.length - 1 ? (
              <FlowArrow
                color={model[modelIndex + 1].color}
                vertical={vertical}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: vertical ? 98 : 365,
          right: vertical ? 98 : 365,
          top: vertical ? 1540 : 835,
          textAlign: "center",
          color: COLORS.muted,
          fontSize: vertical ? 21 : 18,
          letterSpacing: 2.2,
          fontWeight: 800,
        }}
      >
        LABELS CAN CHANGE · IDENTITY AND LINEAGE REMAIN
      </div>
    </SceneShell>
  );
};
