import "./index.css";
import { Composition, Folder } from "remotion";
import { KnowledgeBallFilm } from "./Film";
import { FILM_FRAMES, FPS, STORY } from "./content/story";
import { Scene01Question } from "./scenes/Scene01Question";
import { Scene02MissingStructure } from "./scenes/Scene02MissingStructure";
import { Scene03NewUnit } from "./scenes/Scene03NewUnit";
import { Scene04Space } from "./scenes/Scene04Space";
import { Scene05Verdict } from "./scenes/Scene05Verdict";
import { Scene06Energy } from "./scenes/Scene06Energy";
import { Scene07TwoGraphs } from "./scenes/Scene07TwoGraphs";
import { Scene08SystemAndUse } from "./scenes/Scene08SystemAndUse";
import { Scene09HonestClose } from "./scenes/Scene09HonestClose";

const previews = [
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

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Masters">
        <Composition
          id="KnowledgeBall-YouTube-1080p"
          component={KnowledgeBallFilm}
          durationInFrames={FILM_FRAMES}
          fps={FPS}
          width={1920}
          height={1080}
        />
        <Composition
          id="KnowledgeBall-Instagram-Vertical"
          component={KnowledgeBallFilm}
          durationInFrames={FILM_FRAMES}
          fps={FPS}
          width={1080}
          height={1920}
        />
      </Folder>
      <Folder name="Scenes">
        {STORY.map((scene, index) => {
          const Preview = previews[index];
          return (
            <Composition
              key={scene.id}
              id={`Scene-${scene.id}`}
              component={Preview}
              durationInFrames={scene.durationSeconds * FPS}
              fps={FPS}
              width={1920}
              height={1080}
              defaultProps={{ scene, index }}
            />
          );
        })}
      </Folder>
    </>
  );
};
