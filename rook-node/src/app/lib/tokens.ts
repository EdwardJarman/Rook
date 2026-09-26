/**
 * Rook design tokens — "Quiet" palette.
 *
 * Light: white cream (warm paper, no blue grays). Dark: pitch black like
 * T3 Code — the sidebar and canvas are true near-black, surfaces only a
 * step lighter, and a single green accent appears sparingly. Both schemes
 * share token names so components are theme-correct by construction.
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
  focus: "rgba(23, 113, 73, 0.30)",
};

export const DARK: Tokens = {
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
  focus: "rgba(76, 195, 138, 0.32)",
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
