import { describe, expect, it } from "vitest";

import {
  NODE_ASSETS,
  pickNodeAssetForUserAgent,
} from "../server/download-routes";
import {
  CLI_ASSETS,
  buildPosixCliInstaller,
  buildPowerShellCliInstaller,
  pickCliAssetForUserAgent,
} from "../server/rook-cli-installer";

describe("node download targeting", () => {
  it("targets Windows browsers at the NSIS installer", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
    expect(pickNodeAssetForUserAgent(ua)).toBe("windows");
    expect(NODE_ASSETS.windows).toBe("Rook-Node-Setup.exe");
  });

  it("defaults macOS browsers to Apple Silicon", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";
    expect(pickNodeAssetForUserAgent(ua)).toBe("macArm64");
  });

  it("targets Linux desktops at the AppImage, not Android phones", () => {
    expect(
      pickNodeAssetForUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0",
      ),
    ).toBe("linux");
    expect(
      pickNodeAssetForUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36",
      ),
    ).toBe("page");
  });

  it("sends phones and unknown clients to the download page", () => {
    expect(
      pickNodeAssetForUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile Safari",
      ),
    ).toBe("page");
    expect(pickNodeAssetForUserAgent(undefined)).toBe("page");
    expect(pickNodeAssetForUserAgent("")).toBe("page");
  });
});

describe("Rook CLI installation", () => {
  it("targets the supported standalone CLI archives", () => {
    expect(
      pickCliAssetForUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"),
    ).toBe("windows");
    expect(
      pickCliAssetForUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      ),
    ).toBe("macArm64");
    expect(
      pickCliAssetForUserAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0"),
    ).toBe("linux");
    expect(
      pickCliAssetForUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8)"),
    ).toBe("page");
    expect(CLI_ASSETS.windows).toBe("Rook-CLI-windows-x64.zip");
  });

  it("builds a user-scoped POSIX installer that verifies the CLI", () => {
    const script = buildPosixCliInstaller("https://www.rook.lighting/");
    expect(script).toContain("curl --fail --location");
    expect(script).toContain("ROOK_INSTALL_DIR");
    expect(script).toContain("/api/download/cli?platform=$TARGET");
    expect(script).toContain('"$INSTALL_DIR/rook" --version');
    expect(script).not.toMatch(/sudo|eval/);
  });

  it("builds a user-scoped PowerShell installer that verifies the CLI", () => {
    const script = buildPowerShellCliInstaller("https://www.rook.lighting/");
    expect(script).toContain("$env:LOCALAPPDATA");
    expect(script).toContain("/api/download/cli?platform=windows");
    expect(script).toContain('& (Join-Path $InstallDir "rook.exe") --version');
    expect(script).not.toMatch(/Start-Process|RunAs/);
  });
});
