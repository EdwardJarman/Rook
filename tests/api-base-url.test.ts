import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "../lib/oauth-url";

describe("API base URL resolution", () => {
  it("prefers an explicitly configured base URL", () => {
    expect(
      resolveApiBaseUrl({
        configuredBaseUrl: "https://api.example.com/",
        platform: "web",
        protocol: "http:",
        hostname: "localhost",
        port: "8081",
      }),
    ).toBe("https://api.example.com");
  });

  it("points localhost web dev at the API port, not Metro", () => {
    // Regression test: same-origin ("") made every tRPC/stream call hit
    // Metro's "Not found" page -> "Unexpected token 'N'" chat failures.
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "http:", hostname: "localhost", port: "8081" }),
    ).toBe("http://localhost:3000");
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "http:", hostname: "127.0.0.1", port: "8081" }),
    ).toBe("http://127.0.0.1:3000");
  });

  it("honors a custom local API port and leaves the API origin alone", () => {
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "http:", hostname: "localhost", port: "8081", devApiPort: "4000" }),
    ).toBe("http://localhost:4000");
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "http:", hostname: "localhost", port: "3000" }),
    ).toBe("");
  });

  it("keeps the hosted sandbox hostname mapping", () => {
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "https:", hostname: "8081-abc.region.domain", port: "" }),
    ).toBe("https://3000-abc.region.domain");
  });

  it("keeps production web same-origin and native on the public API", () => {
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "web", protocol: "https:", hostname: "www.rook.lighting", port: "" }),
    ).toBe("");
    expect(
      resolveApiBaseUrl({ configuredBaseUrl: "", platform: "android" }),
    ).toBe("https://www.rook.lighting");
  });
});
