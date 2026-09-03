import {
  AbsoluteFill,
  Img,
  interpolate,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { SceneStatus, StoryScene } from "../content/story";
import { COLORS, FONT_SANS, STATUS_LABELS } from "../theme";
import { Captions } from "./Captions";

const statusColor = (status: SceneStatus) => {
  if (status === "problem") return COLORS.coral;
  if (status === "implemented") return COLORS.green;
  if (status === "boundary") return COLORS.amber;
  if (status === "roadmap") return COLORS.violet;
  return COLORS.cyan;
};

export const SceneShell: React.FC<{
  scene: StoryScene;
  index: number;
  children: React.ReactNode;
}> = ({ scene, index, children }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const vertical = height > width;
  const color = statusColor(scene.status);
  const fadeOut = interpolate(
    frame,
    [(scene.durationSeconds - 0.65) * fps, scene.durationSeconds * fps],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const dots = Array.from({ length: vertical ? 44 : 58 }, (_, dotIndex) => ({
    x: random(`dot-x-${index}-${dotIndex}`) * width,
    y: random(`dot-y-${index}-${dotIndex}`) * height,
    r: 1 + random(`dot-r-${index}-${dotIndex}`) * 2.4,
    phase: random(`dot-p-${index}-${dotIndex}`) * Math.PI * 2,
  }));

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        opacity: fadeOut,
        background: COLORS.ink,
        color: COLORS.white,
        fontFamily: FONT_SANS,
      }}
    >
      <AbsoluteFill
        style={{
          background: [
            `radial-gradient(circle at ${vertical ? "50% 39%" : "72% 48%"}, rgba(52,109,255,.22), transparent 32%)`,
            `radial-gradient(circle at ${vertical ? "4% 18%" : "16% 10%"}, rgba(74,216,255,.11), transparent 28%)`,
            `radial-gradient(circle at 88% 86%, rgba(123,92,255,.16), transparent 32%)`,
            "linear-gradient(135deg, #02030B 0%, #06091B 50%, #030512 100%)",
          ].join(","),
        }}
      />
      <svg
        width={width}
        height={height}
        style={{ position: "absolute", inset: 0, opacity: 0.55 }}
      >
        {dots.map((dot, dotIndex) => {
          const twinkle =
            0.3 + 0.7 * ((Math.sin(frame / 21 + dot.phase) + 1) / 2);
          return (
            <circle
              key={dotIndex}
              cx={dot.x}
              cy={dot.y}
              r={dot.r}
              fill="#C5EFFF"
              opacity={twinkle * 0.45}
            />
          );
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: vertical ? 54 : 74,
          right: vertical ? 54 : 74,
          top: vertical ? 54 : 42,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: vertical ? 18 : 15,
          }}
        >
          <Img
            src={staticFile("brand/knowledge-ball-logo.png")}
            style={{
              width: vertical ? 58 : 48,
              height: vertical ? 58 : 48,
              objectFit: "contain",
            }}
          />
          <div>
            <div
              style={{
                fontSize: vertical ? 22 : 18,
                fontWeight: 800,
                letterSpacing: 1.4,
              }}
            >
              KNOWLEDGE BALL
            </div>
            <div
              style={{
                fontSize: vertical ? 14 : 12,
                color: COLORS.muted,
                letterSpacing: 2.3,
                marginTop: 3,
              }}
            >
              NEW HUMANS · PROJECT 01
            </div>
          </div>
        </div>
        <div
          style={{
            border: `1px solid ${color}66`,
            background: `${color}12`,
            color,
            borderRadius: 999,
            padding: vertical ? "12px 17px" : "9px 15px",
            fontWeight: 800,
            fontSize: vertical ? 15 : 13,
            letterSpacing: 1.8,
            whiteSpace: "nowrap",
          }}
        >
          {STATUS_LABELS[scene.status]}
        </div>
      </div>
      <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          left: vertical ? 54 : 74,
          right: vertical ? 54 : 74,
          bottom: vertical ? 52 : 30,
          height: 3,
          borderRadius: 999,
          background: "rgba(255,255,255,.08)",
          overflow: "hidden",
          zIndex: 22,
        }}
      >
        <div
          style={{
            width: `${((index + interpolate(frame, [0, scene.durationSeconds * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) / 9) * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.blue}, ${COLORS.violet})`,
          }}
        />
      </div>
      <Captions scene={scene} />
    </AbsoluteFill>
  );
};
