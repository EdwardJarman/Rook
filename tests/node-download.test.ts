import { describe, expect, it } from "vitest";

import { NODE_ASSETS, pickNodeAssetForUserAgent } from "../server/download-routes";

describe("node download targeting", () => {
  it("targets Windows browsers at the NSIS installer", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
    expect(pickNodeAssetForUserAgent(ua)).toBe("windows");
    expect(NODE_ASSETS.windows).toBe("Rook-Node-Setup.exe");
  });

  it("defaults macOS browsers to Apple Silicon", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15";
    expect(pickNodeAssetForUserAgent(ua)).toBe("macArm64");
  });

  it("targets Linux desktops at the AppImage, not Android phones", () => {
    expect(pickNodeAssetForUserAgent("Mozilla/5.0 (X11; Linux x86_64) Firefox/126.0")).toBe("linux");
    expect(
      pickNodeAssetForUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36"),
    ).toBe("page");
  });

  it("sends phones and unknown clients to the download page", () => {
    expect(pickNodeAssetForUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile Safari")).toBe("page");
    expect(pickNodeAssetForUserAgent(undefined)).toBe("page");
    expect(pickNodeAssetForUserAgent("")).toBe("page");
  });
});
