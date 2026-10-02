import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultConfig } from "../src/config.js";
import { RookDatabase } from "../src/state/database.js";
import { BotRegistry, RegistryError } from "../src/registry/bot-registry.js";

describe("bot registry", () => {
  let db: RookDatabase;
  let registry: BotRegistry;

  beforeEach(() => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rook-node-test-"));
    const config = defaultConfig({ dataHome: path.join(tempRoot, "data"), requireAuth: false });
    db = new RookDatabase(config);
    registry = new BotRegistry(db);
  });

  afterEach(() => {
    db.close();
  });

  it("registers and lists bots", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    registry.registerBot({ id: "bot-2", name: "Grace", role: "Accountant" });
    expect(registry.listBots()).toHaveLength(2);
    expect(registry.getBot("bot-1")).toMatchObject({ id: "bot-1", name: "Ada" });
  });

  it("creates a primary tab with revision 1 and increments on navigation", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    const tab = registry.createPrimaryTab("bot-1", "https://example.com", "Example");
    expect(tab.groupIndex).toBe(0);
    expect(tab.revision).toBe(1);
    const navigated = registry.recordNavigation(tab.id, "https://example.com/about");
    expect(navigated.revision).toBe(2);
    expect(registry.tabRevision(tab.id)).toBe(2);
  });

  it("rejects operations for unknown bots", () => {
    expect(() => registry.createPrimaryTab("nope", "https://example.com")).toThrow(RegistryError);
  });

  it("enforces the tab limit per bot", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    for (let i = 0; i < 12; i++) registry.openTab("bot-1", `https://example.com/${i}`);
    expect(() => registry.openTab("bot-1", "https://example.com/13")).toThrow(RegistryError);
  });

  it("primaryTab returns existing tab and creates a fallback when absent", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    const primary = registry.primaryTab("bot-1");
    expect(primary.url).toBe("about:blank");
    expect(primary.groupIndex).toBe(0);
    expect(registry.primaryTab("bot-1").id).toBe(primary.id);
  });

  it("restores tabs after a browser restart", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    registry.createPrimaryTab("bot-1", "https://example.com");
    registry.openTab("bot-1", "https://example.com/2");
    const restored = registry.restoreTabs("bot-1", [
      { url: "https://example.com", title: "Home" },
      { url: "https://example.com/2", title: "Two" },
    ]);
    expect(restored).toHaveLength(2);
    expect(registry.tabsForBot("bot-1")).toHaveLength(2);
  });

  it("removes a bot and all its tabs", () => {
    registry.registerBot({ id: "bot-1", name: "Ada", role: "Researcher" });
    const tab = registry.createPrimaryTab("bot-1", "https://example.com");
    registry.removeBot("bot-1");
    expect(registry.getBot("bot-1")).toBeUndefined();
    expect(registry.tabRevision(tab.id)).toBeUndefined();
  });
});