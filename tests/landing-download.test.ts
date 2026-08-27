import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const landingSource = readFileSync(
  fileURLToPath(new URL("../app/index.tsx", import.meta.url)),
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

  it("keeps the dedicated Download Rook action after the CLI control", () => {
    const cliControl = landingSource.indexOf(
      'accessibilityLabel="Copy Rook CLI install command"',
    );
    const downloadControl = landingSource.indexOf(
      'accessibilityLabel="Open Rook downloads"',
    );

    expect(cliControl).toBeGreaterThan(-1);
    expect(downloadControl).toBeGreaterThan(cliControl);
    expect(landingSource).toContain('router.push("/download" as never)');
    expect(landingSource).toContain("Download Rook");
  });
});
