import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { KnowledgeOrb } from "../components/KnowledgeOrb";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";
import { COLORS } from "../theme";

export const Scene01Question: React.FC<{
  scene: StoryScene;
  index: number;
}> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const orbOpacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <SceneShell scene={scene} index={index}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: vertical ? "flex-start" : "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: vertical ? 300 : 105,
            left: vertical ? 62 : 110,
            right: vertical ? 62 : 110,
            zIndex: 4,
          }}
        >
          <TitleBlock
            eyebrow={scene.eyebrow}
            title={scene.title}
            support={scene.support}
            align={vertical ? "left" : "center"}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: vertical ? 665 : 300,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: orbOpacity,
          }}
        >
          <KnowledgeOrb mode="question" size={vertical ? 690 : 610} />
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: vertical ? 995 : 592,
            transform: "translateX(-50%)",
            color: COLORS.muted,
            fontSize: vertical ? 20 : 17,
            letterSpacing: 4,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          ANSWER ≠ EXPLANATION
        </div>
      </div>
    </SceneShell>
  );
};
