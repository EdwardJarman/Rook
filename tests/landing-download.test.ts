import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const landingSource = readFileSync(
  resolve(process.cwd(), "app/index.tsx"),
  "utf8",
);

describe("public landing downloads", () => {
  it("keeps the published, copyable CLI installer endpoints", () => {
    expect(landingSource).toContain(
      "https://www.rook.lighting/api/download/cli/install.sh | sh",
    );
    expect(landingSource).toContain(
      "https://www.rook.lighting/api/download/cli/install.ps1 | iex",
    );
  });

  it("keeps the dedicated Download Rook action alongside the CLI control", () => {
    const cliControl = landingSource.indexOf(
      'accessibilityLabel="Copy Rook CLI install command"',
    );
    const downloadControl = landingSource.indexOf(
      'accessibilityLabel="Open Rook downloads"',
    );

    expect(cliControl).toBeGreaterThan(-1);
    expect(downloadControl).toBeGreaterThan(-1);
    expect(landingSource).toContain('router.push("/download" as never)');
    expect(landingSource).toContain("Download Rook");
  });

  it("uses the shared Rook design tokens instead of a bespoke palette", () => {
    expect(landingSource).toContain("useRookTheme");
    expect(landingSource).not.toContain("#080808");
  });
});
