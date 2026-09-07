import { useThemeContext } from "@/lib/theme-provider";

/**
 * The resolved Rook design tokens for the current color scheme.
 *
 * The app is light-first with a warm paper canvas and deep-ink dark mode.
 * `ink` / `onInk` form the monochrome primary-action pair (buttons, user
 * bubbles, active segments); `accent` is the Rook green used for interactive
 * emphasis, focus, and success states.
 */
export type RookTokens = {
  canvas: string;
  surface: string;
  surfaceAlt: string;
  elevated: string;
  line: string;
  lineStrong: string;
  text: string;
  textSoft: string;
  textFaint: string;
  ink: string;
  onInk: string;
  accent: string;
  accentSoft: string;
  mint: string;
  mintSoft: string;
  amber: string;
  amberSoft: string;
  coral: string;
  coralSoft: string;
  scrim: string;
  grabber: string;
  placeholder: string;
  shadow: string;
};

export type ToneName = "mint" | "amber" | "coral" | "muted";

/* Mirrors the desktop "Quiet" palette (rook-node/src/app/lib/tokens.ts):
   warm paper cream in light, true midnight black in dark. */
const LIGHT: RookTokens = {
  canvas: "#FAF9F4",
  surface: "#FFFFFF",
  surfaceAlt: "#F2F0E9",
  elevated: "#FFFFFF",
  line: "#EBE8DF",
  lineStrong: "#DDD9CE",
  text: "#1E1C18",
  textSoft: "#6E6A60",
  textFaint: "#A19C90",
  ink: "#23211C",
  onInk: "#FAF9F4",
  accent: "#177149",
  accentSoft: "rgba(23, 113, 73, 0.08)",
  mint: "#177149",
  mintSoft: "rgba(23, 113, 73, 0.08)",
  amber: "#8F6400",
  amberSoft: "rgba(143, 100, 0, 0.08)",
  coral: "#B3402F",
  coralSoft: "rgba(179, 64, 47, 0.07)",
  scrim: "rgba(30, 28, 24, 0.40)",
  grabber: "#DBD7CC",
  placeholder: "#A8A396",
  shadow: "#26241F",
};

/* True midnight black like T3 Code: canvas and surfaces are near-black, only
   a step apart, with a single green accent appearing sparingly. */
const DARK: RookTokens = {
  canvas: "#000000",
  surface: "#0C0C0C",
  surfaceAlt: "#151515",
  elevated: "#121212",
  line: "#1D1D1D",
  lineStrong: "#2B2B2B",
  text: "#EDEBE6",
  textSoft: "#9B978E",
  textFaint: "#6D6A62",
  ink: "#EDEBE6",
  onInk: "#0A0A0A",
  accent: "#4CC38A",
  accentSoft: "rgba(76, 195, 138, 0.10)",
  mint: "#4CC38A",
  mintSoft: "rgba(76, 195, 138, 0.10)",
  amber: "#E5B567",
  amberSoft: "rgba(229, 181, 103, 0.10)",
  coral: "#E5735F",
  coralSoft: "rgba(229, 115, 95, 0.10)",
  scrim: "rgba(0, 0, 0, 0.66)",
  grabber: "#2B2B2B",
  placeholder: "#5E5B55",
  shadow: "#000000",
};

/** Resolve the design tokens for whichever scheme is active. */
export function useRookTheme() {
  const { colorScheme } = useThemeContext();
  const dark = colorScheme === "dark";
  return { scheme: colorScheme, dark, colors: dark ? DARK : LIGHT };
}

/** Blend any hex color toward white (amount < 0) or black (amount > 0). */
export function shade(hex: string, amount: number): string {
  const normalize = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? channel * (1 - amount) : channel + (255 - channel) * -amount)));
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `#${[normalize(r), normalize(g), normalize(b)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** A translucent variant of a hex color, e.g. tint("#177149", 0.12). */
export function tint(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
