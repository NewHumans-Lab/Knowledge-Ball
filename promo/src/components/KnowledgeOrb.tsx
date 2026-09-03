import { interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../theme";

type OrbMode =
  | "question"
  | "network"
  | "shells"
  | "verdict"
  | "mastery"
  | "close";

export const KnowledgeOrb: React.FC<{
  mode?: OrbMode;
  size?: number;
  labels?: boolean;
}> = ({ mode = "network", size, labels = false }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  const actualSize = size ?? (vertical ? 820 : 760);
  const center = actualSize / 2;
  const breathe = 1 + Math.sin(frame / 37) * 0.018;
  const rotation = frame * 0.22;
  const radii = [actualSize * 0.19, actualSize * 0.31, actualSize * 0.43];
  const colors = [COLORS.cyan, COLORS.blue, COLORS.violet];
  const nodeCount = vertical ? 30 : 36;
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const shell = index % 3;
    const angle = (index / nodeCount) * Math.PI * 2 * 3.4 + shell * 0.7;
    const radius = radii[shell] * (0.82 + random(`orb-radius-${index}`) * 0.18);
    const x = center + Math.cos(angle + (rotation * Math.PI) / 180) * radius;
    const squash = 0.66 + shell * 0.055;
    const y =
      center + Math.sin(angle + (rotation * Math.PI) / 180) * radius * squash;
    const z = Math.sin(angle + (rotation * Math.PI) / 180);
    return { x, y, z, shell, r: 5.5 + (z + 1) * 3.5, index };
  }).sort((a, b) => a.z - b.z);
  const reveal = interpolate(frame, [5, 42], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        width: actualSize,
        height: actualSize,
        transform: `scale(${breathe})`,
        position: "relative",
      }}
    >
      <svg
        width={actualSize}
        height={actualSize}
        viewBox={`0 0 ${actualSize} ${actualSize}`}
      >
        <defs>
          <radialGradient id="sun" cx="38%" cy="32%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="22%" stopColor="#A8F1FF" />
            <stop offset="58%" stopColor="#346DFF" />
            <stop offset="100%" stopColor="#09153F" />
          </radialGradient>
          <radialGradient id="glow">
            <stop offset="0%" stopColor="#4AD8FF" stopOpacity=".45" />
            <stop offset="100%" stopColor="#346DFF" stopOpacity="0" />
          </radialGradient>
          <filter id="blur">
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <filter id="nodeGlow">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={actualSize * 0.22}
          fill="url(#glow)"
          filter="url(#blur)"
          opacity={0.75}
        />
        {radii.map((radius, shell) => (
          <g
            key={radius}
            opacity={reveal * (mode === "question" && shell > 0 ? 0.26 : 1)}
          >
            <ellipse
              cx={center}
              cy={center}
              rx={radius}
              ry={radius * (0.66 + shell * 0.055)}
              fill="none"
              stroke={colors[shell]}
              strokeOpacity={0.25}
              strokeWidth={2.2}
              strokeDasharray={shell === 2 ? "4 12" : undefined}
            />
            <ellipse
              cx={center}
              cy={center}
              rx={radius * 0.34}
              ry={radius}
              fill="none"
              stroke={colors[shell]}
              strokeOpacity={0.13}
              strokeWidth={1.5}
              transform={`rotate(${18 + shell * 24} ${center} ${center})`}
            />
          </g>
        ))}
        {mode !== "question" &&
          nodes.slice(1).map((node, index) => {
            const previous = nodes[(index * 7) % nodes.length];
            if (previous.shell !== node.shell && index % 3 !== 0) return null;
            return (
              <line
                key={`line-${node.index}`}
                x1={node.x}
                y1={node.y}
                x2={previous.x}
                y2={previous.y}
                stroke={colors[node.shell]}
                strokeOpacity={0.09 + Math.max(0, node.z) * 0.12}
                strokeWidth={1.3}
              />
            );
          })}
        {nodes.map((node) => (
          <g
            key={node.index}
            opacity={reveal * (mode === "question" ? 0.2 : 1)}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r * 2.2}
              fill={colors[node.shell]}
              opacity={0.12}
              filter="url(#nodeGlow)"
            />
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={colors[node.shell]}
              opacity={0.55 + (node.z + 1) * 0.18}
            />
            <circle
              cx={node.x - node.r * 0.25}
              cy={node.y - node.r * 0.25}
              r={node.r * 0.27}
              fill="#fff"
              opacity={0.72}
            />
          </g>
        ))}
        <circle
          cx={center}
          cy={center}
          r={actualSize * 0.093}
          fill="url(#sun)"
        />
        <circle
          cx={center}
          cy={center}
          r={actualSize * 0.12}
          fill="none"
          stroke="#8BE8FF"
          strokeOpacity=".28"
          strokeWidth="2"
        />
        {mode === "question" ? (
          <text
            x={center}
            y={center + 19}
            textAnchor="middle"
            fill="#fff"
            fontSize={actualSize * 0.13}
            fontWeight="800"
          >
            ?
          </text>
        ) : null}
        {mode === "verdict" ? (
          <g
            transform={`translate(${center + actualSize * 0.19} ${center - actualSize * 0.24})`}
          >
            <circle
              r={actualSize * 0.055}
              fill="#07182C"
              stroke={COLORS.green}
              strokeWidth="3"
            />
            <path
              d={`M ${-actualSize * 0.022} 0 l ${actualSize * 0.015} ${actualSize * 0.017} l ${actualSize * 0.032} ${-actualSize * 0.039}`}
              fill="none"
              stroke={COLORS.green}
              strokeWidth={actualSize * 0.009}
              strokeLinecap="round"
            />
          </g>
        ) : null}
      </svg>
      {labels && (
        <>
          {[
            "DEFINITIONS · FACTS · LOGIC",
            "ADMITTED PUBLIC KNOWLEDGE",
            "PENDING · DISPUTED · PREDICTIVE",
          ].map((label, i) => (
            <div
              key={label}
              style={{
                position: "absolute",
                left: center + radii[i] * 0.75,
                top: center - radii[i] * (0.66 + i * 0.055) - 16,
                color: colors[i],
                fontSize: vertical ? 17 : 15,
                fontWeight: 800,
                letterSpacing: 1.25,
                whiteSpace: "nowrap",
                textShadow: "0 5px 20px #030512",
              }}
            >
              {label}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
