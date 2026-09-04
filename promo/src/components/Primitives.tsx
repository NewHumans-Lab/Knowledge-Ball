import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT_SANS } from "../theme";

export const GlassCard: React.FC<{
  children: React.ReactNode;
  accent?: string;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, accent = COLORS.blue, delay = 0, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({
    frame: frame - delay,
    fps,
    config: { damping: 17, stiffness: 100 },
  });
  return (
    <div
      style={{
        border: `1px solid ${accent}55`,
        background:
          "linear-gradient(145deg, rgba(17,24,57,.82), rgba(5,8,25,.68))",
        boxShadow: `0 26px 90px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.05), 0 0 44px ${accent}0F`,
        backdropFilter: "blur(20px)",
        borderRadius: 30,
        opacity: interpolate(frame - delay, [0, 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        transform: `translateY(${(1 - enter) * 35}px) scale(${0.97 + enter * 0.03})`,
        fontFamily: FONT_SANS,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Dot: React.FC<{ color?: string; size?: number }> = ({
  color = COLORS.cyan,
  size = 12,
}) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: color,
      boxShadow: `0 0 ${size * 2}px ${color}`,
      display: "inline-block",
      flex: "0 0 auto",
    }}
  />
);

export const MiniBadge: React.FC<{
  children: React.ReactNode;
  color?: string;
}> = ({ children, color = COLORS.cyan }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "8px 13px",
      borderRadius: 999,
      color,
      background: `${color}12`,
      border: `1px solid ${color}42`,
      fontSize: 15,
      fontWeight: 800,
      letterSpacing: 1.1,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

export const FlowArrow: React.FC<{ color?: string; vertical?: boolean }> = ({
  color = COLORS.blue,
  vertical = false,
}) => (
  <div
    style={{
      height: vertical ? 58 : 2,
      width: vertical ? 2 : 58,
      background: `linear-gradient(${vertical ? "180deg" : "90deg"}, ${color}20, ${color})`,
      position: "relative",
      flex: "0 0 auto",
    }}
  >
    <div
      style={{
        position: "absolute",
        right: vertical ? -5 : -1,
        bottom: vertical ? -1 : undefined,
        top: vertical ? undefined : -5,
        width: 10,
        height: 10,
        borderTop: vertical ? undefined : `2px solid ${color}`,
        borderRight: `2px solid ${color}`,
        borderBottom: vertical ? `2px solid ${color}` : undefined,
        transform: vertical ? "rotate(45deg)" : "rotate(45deg)",
      }}
    />
  </div>
);
