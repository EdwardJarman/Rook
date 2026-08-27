import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const avatar = readFileSync(
  resolve(process.cwd(), "components/rook-primitives.tsx"),
  "utf8",
);
const chatScreen = readFileSync(
  resolve(process.cwd(), "app/(tabs)/index.tsx"),
  "utf8",
);
const workingIndicator = readFileSync(
  resolve(process.cwd(), "components/ai-working-indicator.tsx"),
  "utf8",
);
const activityTrace = readFileSync(
  resolve(process.cwd(), "components/agent-activity-trace.tsx"),
  "utf8",
);
const modelPicker = readFileSync(
  resolve(process.cwd(), "components/composer-model-picker.tsx"),
  "utf8",
);
const agent = readFileSync(
  resolve(process.cwd(), "server/integrations/excel-agent.ts"),
  "utf8",
);

describe("chat experience refinements", () => {
  it("falls back to a valid Bot orb instead of rendering arbitrary legacy icon art", () => {
    expect(avatar).toContain('icon={customIdentity ? icon : "bot-orb:matte"}');
    expect(avatar).toContain("<BotIdentityMark");
    expect(avatar).not.toContain("materialGlyphMap");
  });

  it("records and renders only user-safe response activity", () => {
    expect(agent).toContain("shouldSearchPublicWeb(input.message)");
    expect(agent).toContain("await searchPublicWeb(publicSearchQuery)");
    expect(agent).toContain("trace,");
    expect(agent).toContain("never claim you opened a source");
    expect(chatScreen).toContain("<AgentActivityTrace");
    expect(workingIndicator).toContain("Reading your request");
    expect(agent).toContain("Public search result");
    expect(activityTrace).toContain("Linking.openURL");
  });

  it("uses a compact rounded model dialog without dropping the provider model list", () => {
    expect(modelPicker).toContain("<Modal");
    expect(modelPicker).not.toContain("<Sheet");
    expect(modelPicker).toContain("modelsForProvider");
    expect(modelPicker).toContain("models.map((model)");
    expect(modelPicker).toContain("borderRadius: 22");
  });
});
