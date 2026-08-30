import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/theme";

/**
 * A soft-tinted squircle avatar with a centered glyph. The icon prop accepts
 * a Material icon name (passed as a string) and is rendered through a simple
 * emoji/initial fallback so the desktop app doesn't need to ship the
 * @expo/vector-icons web font.
 */
const FALLBACK_GLYPHS: Record<string, string> = {
  bot: "◈",
  sparkles: "✦",
  search: "◎",
  pen: "✎",
  code: "⌘",
  image: "◐",
  shield: "⛨",
  mail: "✉",
  default: "◈",
};

export function Avatar({
  color = "#0E7C59",
  size = 40,
  icon,
  className,
}: {
  color?: string;
  size?: number;
  icon?: string;
  className?: string;
}) {
  const { tokens } = useTheme();
  const glyph = FALLBACK_GLYPHS[icon ?? "default"] ?? FALLBACK_GLYPHS.default;
  return (
    <span
      role="img"
      aria-hidden
      className={cn("avatar", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.32),
        background: tokens.surface,
        color,
        border: `1px solid ${tokens.line}`,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.45),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}
