import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_DISPLAY, FONT_SANS } from "../theme";

type Props = {
  eyebrow: string;
  title: string;
  support: string;
  align?: "left" | "center";
  compact?: boolean;
};

export const TitleBlock: React.FC<Props> = ({
  eyebrow,
  title,
  support,
  align = "left",
  compact = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const vertical = height > width;
  const rise = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90, mass: 0.9 },
  });
  const opacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const titleSize = vertical ? (compact ? 74 : 88) : compact ? 70 : 94;

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${(1 - rise) * 34}px)`,
        textAlign: align,
        color: COLORS.white,
        maxWidth: align === "center" ? "100%" : vertical ? "100%" : 920,
      }}
    >
      <div
        style={{
          color: COLORS.cyan,
          fontFamily: FONT_SANS,
          fontWeight: 800,
          fontSize: vertical ? 25 : 22,
          letterSpacing: vertical ? 4.5 : 4,
          lineHeight: 1.2,
          marginBottom: vertical ? 26 : 22,
        }}
      >
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: titleSize,
          letterSpacing: -4,
          lineHeight: 0.98,
          textWrap: "balance",
          textShadow: "0 20px 70px rgba(52,109,255,0.23)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: vertical ? 30 : 26,
          color: COLORS.muted,
          fontFamily: FONT_SANS,
          fontWeight: 500,
          fontSize: vertical ? 34 : 30,
          letterSpacing: -0.5,
          lineHeight: 1.3,
          textWrap: "balance",
        }}
      >
        {support}
      </div>
    </div>
  );
};
