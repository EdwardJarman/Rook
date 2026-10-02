import { describe, expect, it } from "vitest";

import { cliInstallCommands, installApiBaseUrl, PROD_ROOK_ORIGIN } from "./cli-install";

describe("cli install commands", () => {
  it("points local dev pages at the local API server", () => {
    expect(
      installApiBaseUrl({ protocol: "http:", hostname: "localhost", port: "8081" }),
    ).toBe("http://localhost:3000");
    expect(
      installApiBaseUrl({ protocol: "http:", hostname: "127.0.0.1", port: "8081" }),
    ).toBe("http://127.0.0.1:3000");
  });

  it("falls back to the page origin, then production", () => {
    expect(
      installApiBaseUrl({ protocol: "https:", hostname: "www.rook.lighting", port: "" }),
    ).toBe("https://www.rook.lighting");
    expect(installApiBaseUrl({})).toBe(PROD_ROOK_ORIGIN);
  });

  it("builds copyable one-liners for both shells", () => {
    expect(cliInstallCommands("https://www.rook.lighting/")).toEqual({
      posix: "curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh",
      powershell: "irm https://www.rook.lighting/api/download/cli/install.ps1 | iex",
    });
    expect(cliInstallCommands("http://localhost:3000").posix).toContain("localhost:3000");
  });
});
