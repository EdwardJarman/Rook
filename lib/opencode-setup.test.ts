import { describe, expect, it } from "vitest";

import { buildOpenCodeSetupPrompt, openCodeBaseUrl } from "./opencode-setup";

describe("opencode setup prompt", () => {
  it("defaults to the loopback managed server", () => {
    expect(openCodeBaseUrl()).toBe("http://127.0.0.1:4123");
  });

  it("instructs the agent end to end and hands the human the Rook lines", () => {
    const prompt = buildOpenCodeSetupPrompt();
    expect(prompt).toMatch(/opencode --version/);
    expect(prompt).toContain("opencode serve --port 4123 --hostname 127.0.0.1");
    expect(prompt).toContain("/global/health");
    expect(prompt).toContain("OPENCODE_BASE_URL=http://127.0.0.1:4123");
    expect(prompt).toContain("OPENCODE_SERVER_PASSWORD");
    expect(prompt).toMatch(/\.env\.local/);
  });

  it("adapts to a custom base url", () => {
    const prompt = buildOpenCodeSetupPrompt("http://192.168.1.9:8080");
    expect(prompt).toContain("OPENCODE_BASE_URL=http://192.168.1.9:8080");
  });
});
