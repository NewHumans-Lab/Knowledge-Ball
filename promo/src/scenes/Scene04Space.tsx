import { useVideoConfig } from "remotion";
import { KnowledgeOrb } from "../components/KnowledgeOrb";
import { SceneShell } from "../components/SceneShell";
import { TitleBlock } from "../components/TitleBlock";
import type { StoryScene } from "../content/story";

export const Scene04Space: React.FC<{ scene: StoryScene; index: number }> = ({
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
          top: vertical ? 165 : 155,
          width: vertical ? 950 : 730,
          zIndex: 8,
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
          left: vertical ? "50%" : 1010,
          top: vertical ? 650 : 105,
          transform: vertical ? "translateX(-50%)" : undefined,
        }}
      >
        <KnowledgeOrb mode="shells" size={vertical ? 860 : 850} labels />
      </div>
    </SceneShell>
  );
};
