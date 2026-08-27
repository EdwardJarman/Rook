import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appearanceSource = readFileSync(
  resolve(process.cwd(), "constants/auth-web.ts"),
  "utf8",
);
const shellSource = readFileSync(
  resolve(process.cwd(), "components/auth-web-shell.tsx"),
  "utf8",
);

describe("public authentication appearance", () => {
  it("uses labeled block buttons rather than compact provider icons", () => {
    expect(appearanceSource).toContain('socialButtonsVariant: "blockButton"');
    expect(appearanceSource).toContain("socialButtonsBlockButton");
    expect(appearanceSource).toContain('width: "100%"');
    expect(appearanceSource).toContain("Continue with {{provider|titleize}}");
  });

  it("shares the landing page’s dark editorial foundation", () => {
    expect(shellSource).toContain('backgroundColor: "#080808"');
    expect(shellSource).toContain('borderBottomColor: "#35342F"');
    expect(shellSource).toContain('color: "#F1F0EB"');
    expect(shellSource).not.toContain("bloom-background");
  });
});
