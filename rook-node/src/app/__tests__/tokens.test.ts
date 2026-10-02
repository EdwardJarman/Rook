import { describe, expect, it, beforeEach } from "vitest";

import {
  tokenColor,
  tokensFor,
  type ResolvedScheme,
  type Tokens,
} from "@/lib/tokens";

const RESET_KEY = "rook:linked-folders";

describe("rook design tokens", () => {
  it("exposes a complete token set for both schemes", () => {
    const keys: Array<keyof Tokens> = [
      "canvas",
      "surface",
      "surfaceAlt",
      "elevated",
      "line",
      "lineStrong",
      "text",
      "textSoft",
      "textFaint",
      "ink",
      "onInk",
      "accent",
      "accentSoft",
      "mint",
      "mintSoft",
      "amber",
      "amberSoft",
      "coral",
      "coralSoft",
      "scrim",
      "grabber",
      "placeholder",
      "shadow",
      "focus",
    ];
    for (const scheme of ["light", "dark"] as ResolvedScheme[]) {
      const t = tokensFor(scheme);
      for (const k of keys) {
        expect(t[k], `missing token ${k} for ${scheme}`).toBeTruthy();
      }
      // Light and dark must differ for at least canvas + text.
      expect(t.canvas).not.toBe(tokensFor(scheme === "light" ? "dark" : "light").canvas);
    }
  });
});

describe("tokenColor", () => {
  it("returns a hex string for valid inputs", () => {
    expect(tokenColor("#000000", 0)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tokenColor("#FFFFFF", 0).toLowerCase()).toBe("#ffffff");
  });

  it("darkens when amount > 0 and lightens when amount < 0", () => {
    const darker = tokenColor("#888888", 0.5);
    const lighter = tokenColor("#888888", -0.5);
    // Each channel should move in the right direction.
    const dCh = parseInt(darker.slice(1, 3), 16);
    const lCh = parseInt(lighter.slice(1, 3), 16);
    expect(dCh).toBeLessThan(0x88);
    expect(lCh).toBeGreaterThan(0x88);
  });

  it("passes through non-hex inputs unchanged", () => {
    expect(tokenColor("not a color", 0.2)).toBe("not a color");
  });
});
