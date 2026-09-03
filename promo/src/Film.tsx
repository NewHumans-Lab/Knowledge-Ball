import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, staticFile } from "remotion";
import { STORY, sceneStartFrame } from "./content/story";
import { Scene01Question } from "./scenes/Scene01Question";
import { Scene02MissingStructure } from "./scenes/Scene02MissingStructure";
import { Scene03NewUnit } from "./scenes/Scene03NewUnit";
import { Scene04Space } from "./scenes/Scene04Space";
import { Scene05Verdict } from "./scenes/Scene05Verdict";
import { Scene06Energy } from "./scenes/Scene06Energy";
import { Scene07TwoGraphs } from "./scenes/Scene07TwoGraphs";
import { Scene08SystemAndUse } from "./scenes/Scene08SystemAndUse";
import { Scene09HonestClose } from "./scenes/Scene09HonestClose";

const scenes = [
  Scene01Question,
  Scene02MissingStructure,
  Scene03NewUnit,
  Scene04Space,
  Scene05Verdict,
  Scene06Energy,
  Scene07TwoGraphs,
  Scene08SystemAndUse,
  Scene09HonestClose,
] as const;

export const KnowledgeBallFilm: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: "#030512" }}>
      <Audio src={staticFile("audio/narration-en.mp3")} volume={1} />
      <Audio src={staticFile("audio/ambient-bed.mp3")} volume={0.1} />
      {STORY.map((scene, index) => {
        const Component = scenes[index];
        return (
          <Sequence
            key={scene.id}
            name={`${index + 1}. ${scene.title}`}
            from={sceneStartFrame(index)}
            durationInFrames={scene.durationSeconds * 30}
            premountFor={30}
          >
            <Component scene={scene} index={index} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
