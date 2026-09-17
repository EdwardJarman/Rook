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
const systemPrompt = readFileSync(
  resolve(process.cwd(), "server/ai/system-prompt.ts"),
  "utf8",
);
const reliability = readFileSync(
  resolve(process.cwd(), "server/ai/agent-reliability.ts"),
  "utf8",
);
const botSheet = readFileSync(
  resolve(process.cwd(), "components/bot-create-sheet.tsx"),
  "utf8",
);
const chatScreenFile = readFileSync(
  resolve(process.cwd(), "app/(tabs)/index.tsx"),
  "utf8",
);
const connectorsSheet = readFileSync(
  resolve(process.cwd(), "components/composer-connectors-sheet.tsx"),
  "utf8",
);
const identityPicker = readFileSync(
  resolve(process.cwd(), "components/bot-identity-picker.tsx"),
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
    // Honesty rule lives in the versioned system prompt (v2); the agent
    // imports it via buildRookSystemPrompt.
    expect(`${agent}${systemPrompt}${reliability}`).toContain(
      "never claim you opened a page",
    );
    expect(systemPrompt).toContain("Your computer (Rook Node");
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

  it("keeps the Bot maker free of per-Bot model locks and ownership boxes", () => {
    expect(botSheet).not.toContain("AiModelSelector");
    expect(botSheet).not.toContain("What it owns");
    expect(botSheet).toContain("defaultModelForProvider");
  });

  it("renders selected finish cards on the theme canvas instead of tinted color", () => {
    expect(identityPicker).toContain("colors.canvas");
    expect(identityPicker).not.toContain("tint(color");
  });

  it("shows agent-built files in a code panel with download and no auto-run", () => {
    expect(chatScreenFile).toContain("FileViewerPanel");
    expect(chatScreenFile).toContain("Download");
    expect(chatScreenFile).toContain("Code view only");
    expect(chatScreenFile).toContain("Tap to view code");
    expect(chatScreenFile).not.toContain("DeliverableCard");
  });

  it("attaches skills per message from the connectors sheet", () => {
    expect(connectorsSheet).toContain("attachedSkillIds");
    expect(connectorsSheet).toContain("onToggleSkill");
    expect(connectorsSheet).toContain("ai.skills");
    expect(chatScreenFile).toContain("skillIds");
    expect(chatScreenFile).toContain("setAttachedSkills([])");
  });

  it("offers every provider's models in the composer instead of locking to one", () => {
    expect(modelPicker).toContain("PROVIDER_ORDER");
    expect(modelPicker).toContain("providerForModel");
    expect(modelPicker).toContain("MODELS · ALL PROVIDERS");
    expect(modelPicker).toContain("showGroupHeader");
  });
});
