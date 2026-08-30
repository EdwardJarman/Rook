/**
 * Rook design tokens — light + dark.
 *
 * Light: warm paper canvas with deep ink surfaces and a single green accent.
 * Dark:  true ink mode with mint accent. Both schemes share token names so
 *        components are theme-correct by construction.
 */

export type Tokens = {
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
  focus: string;
};

export const LIGHT: Tokens = {
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
  focus: "rgba(14, 124, 89, 0.35)",
};

export const DARK: Tokens = {
  canvas: "#0A0C10",
  surface: "#141820",
  surfaceAlt: "#1B202A",
  elevated: "#1D222D",
  line: "#262C38",
  lineStrong: "#333B49",
  text: "#F1F3F6",
  textSoft: "#A6AFBC",
  textFaint: "#79828F",
  ink: "#ECEFF3",
  onInk: "#10131A",
  accent: "#6FE8BC",
  accentSoft: "rgba(111, 232, 188, 0.13)",
  mint: "#6FE8BC",
  mintSoft: "rgba(111, 232, 188, 0.13)",
  amber: "#F0BE4F",
  amberSoft: "rgba(240, 190, 79, 0.12)",
  coral: "#FF8080",
  coralSoft: "rgba(255, 128, 128, 0.11)",
  scrim: "rgba(4, 6, 10, 0.62)",
  grabber: "#3A414E",
  placeholder: "#66707E",
  shadow: "#000000",
  focus: "rgba(111, 232, 188, 0.35)",
};

export type Scheme = "light" | "dark" | "system";
export type ResolvedScheme = "light" | "dark";

export const tokensFor = (scheme: ResolvedScheme): Tokens =>
  scheme === "dark" ? DARK : LIGHT;

/**
 * Mix a hex color toward black (positive amount) or white (negative).
 * Mirrors the same algorithm the Expo `lib/ui.ts` uses so the Vite app
 * matches the web client's shading exactly.
 */
export function tokenColor(hex: string, amount: number): string {
  if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return hex;
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const mix = (c: number) =>
    Math.max(
      0,
      Math.min(
        255,
        Math.round(amount >= 0 ? c * (1 - amount) : c + (255 - c) * -amount),
      ),
    );
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", Roboto, Helvetica, Arial, sans-serif';
export const monoStack =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
