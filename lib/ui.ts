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

const LIGHT: RookTokens = {
  canvas: "#F7F7F4",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F1EC",
  elevated: "#FFFFFF",
  line: "#E9E8E2",
  lineStrong: "#D9D8D1",
  text: "#191C22",
  textSoft: "#565E6B",
  textFaint: "#8A9099",
  ink: "#1A1D23",
  onInk: "#FFFFFF",
  accent: "#0E7C59",
  accentSoft: "rgba(14, 124, 89, 0.09)",
  mint: "#0E7C59",
  mintSoft: "rgba(14, 124, 89, 0.09)",
  amber: "#9A6700",
  amberSoft: "rgba(154, 103, 0, 0.09)",
  coral: "#C03B3B",
  coralSoft: "rgba(192, 59, 59, 0.08)",
  scrim: "rgba(16, 18, 24, 0.42)",
  grabber: "#D8D7D0",
  placeholder: "#A2A8B0",
  shadow: "#2A3038",
};

/* A plain, neutral midnight-black dark mode rather than a blue-tinted one:
   every gray here is desaturated so nothing reads as "AI navy". */
const DARK: RookTokens = {
  canvas: "#0A0A0B",
  surface: "#17171A",
  surfaceAlt: "#1D1D20",
  elevated: "#1F1F22",
  line: "#2A2A2E",
  lineStrong: "#3A3A3F",
  text: "#F2F2F3",
  textSoft: "#A8A8AC",
  textFaint: "#83838A",
  ink: "#ECECEE",
  onInk: "#101012",
  accent: "#6FE8BC",
  accentSoft: "rgba(111, 232, 188, 0.13)",
  mint: "#6FE8BC",
  mintSoft: "rgba(111, 232, 188, 0.13)",
  amber: "#F0BE4F",
  amberSoft: "rgba(240, 190, 79, 0.12)",
  coral: "#FF8080",
  coralSoft: "rgba(255, 128, 128, 0.11)",
  scrim: "rgba(0, 0, 0, 0.62)",
  grabber: "#3D3D42",
  placeholder: "#6B6B70",
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

/** A translucent variant of a hex color, e.g. tint("#0E7C59", 0.12). */
export function tint(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
