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
const computer = readFileSync(
  resolve(process.cwd(), "server/integrations/cloud-computer.ts"),
  "utf8",
);

describe("chat experience refinements", () => {
  it("falls back to a valid Bot orb instead of rendering arbitrary legacy icon art", () => {
    expect(avatar).toContain('icon={customIdentity ? icon : "bot-orb:matte"}');
    expect(avatar).toContain("<BotIdentityMark");
    expect(avatar).not.toContain("materialGlyphMap");
  });

  it("records and renders only real response activity", () => {
    expect(agent).toContain("shouldSearchPublicWeb(input.message)");
    expect(agent).toContain("await searchPublicWeb(publicSearchQuery)");
    expect(agent).toContain("trace,");
    expect(agent).toContain("never claim you opened a source");
    expect(chatScreen).toContain("<AgentActivityTrace");
    expect(chatScreen).not.toContain("Save to Library");
    expect(chatScreen).toContain("<BotFilesDock");
    expect(chatScreen).toContain("open={filesOpen}");
    expect(chatScreen).toContain("nodes.computer.browse");
    expect(chatScreen).toContain("nodes.computer.readFile");
    expect(workingIndicator).toContain("phaseHeadline");
    expect(workingIndicator).toContain("startedAtMs");
    expect(workingIndicator).toContain("<DrivePixels color={colors.text} />");
    expect(workingIndicator).not.toContain("<Sparkle");
    expect(workingIndicator).not.toContain("Thinking through a plan");
    expect(workingIndicator).not.toContain("Checking connected tools");
    expect(chatScreen).toContain("startedAtMs={replyStartedAtMs}");
    expect(chatScreen).toContain("Resize files panel");
    expect(chatScreen).toContain("onWidthChange");
    expect(agent).toContain("Public search result");
    expect(activityTrace).toContain("Linking.openURL");
    expect(activityTrace).toContain("isBoilerplate");
  });

  it("gives every bot the same shared-computer knowledge", () => {
    expect(agent).toContain("cloudComputerStatusForAgent(input.userId)");
    expect(agent).toContain("computer.toolsAvailable ? CLOUD_TOOLS : []");
    expect(computer).toContain("cloudComputerStatusForAgent");
    expect(computer).toContain("You have a shared computer");
    expect(computer).toContain("computer_write_file");
    expect(computer).toContain("no computer is reachable for this user");
  });

  it("stamps real elapsed times on trace steps", () => {
    expect(agent).toContain("atMs: Date.now() - traceClock");
    expect(agent).toContain("const traceClock = Date.now()");
    expect(activityTrace).toContain("formatWorkingElapsed(step.atMs)");
  });

  it("uses a compact rounded model dialog without dropping the provider model list", () => {
    expect(modelPicker).toContain("<Modal");
    expect(modelPicker).not.toContain("<Sheet");
    expect(modelPicker).toContain("modelsForProvider");
    expect(modelPicker).toContain("models.map((model)");
    expect(modelPicker).toContain("borderRadius: 22");
  });
});
