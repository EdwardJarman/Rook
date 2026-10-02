/**
 * Bot registry: durable Bot-to-page mapping and tab groups.
 *
 * Every Bot receives a stable tab group, a primary page, pop-up pages, and a
 * durable page registry. Tabs are versioned with a monotonically increasing
 * revision so commands can be checked against the page the model observed.
 */
import type { BotRecord, TabRecord } from "../types.js";
import { MAX_OPEN_TABS_PER_BOT } from "../types.js";
import type { RookDatabase } from "../state/database.js";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export class BotRegistry {
  constructor(private readonly db: RookDatabase) {}

  registerBot(input: { id: string; name: string; role: string; identity?: "shared" | "private"; profileDir?: string }): BotRecord {
    const bot: BotRecord = {
      id: input.id,
      name: input.name,
      role: input.role,
      identity: input.identity ?? "shared",
      profileDir: input.profileDir,
      createdAt: new Date().toISOString(),
    };
    this.db.upsertBot(bot);
    return bot;
  }

  getBot(botId: string): BotRecord | undefined {
    return this.db.getBot(botId);
  }

  listBots(): BotRecord[] {
    return this.db.listBots();
  }

  removeBot(botId: string): void {
    this.db.removeBot(botId);
  }

  /** Create the Bot's first tab (primary page) with revision 1. */
  createPrimaryTab(botId: string, url: string, title = ""): TabRecord {
    const bot = this.db.getBot(botId);
    if (!bot) throw new RegistryError("Unknown Bot");
    const existing = this.db.listTabs(botId);
    if (existing.length >= MAX_OPEN_TABS_PER_BOT) throw new RegistryError("Tab limit reached for this Bot");
    const now = new Date().toISOString();
    const tab: TabRecord = {
      id: `tab-${cryptoRandom()}`,
      botId,
      groupIndex: existing.length,
      url,
      title,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db.upsertTab(tab);
    return tab;
  }

  openTab(botId: string, url: string, title = ""): TabRecord {
    const existing = this.db.listTabs(botId);
    if (existing.length >= MAX_OPEN_TABS_PER_BOT) throw new RegistryError("Tab limit reached for this Bot");
    const now = new Date().toISOString();
    const tab: TabRecord = {
      id: `tab-${cryptoRandom()}`,
      botId,
      groupIndex: existing.length,
      url,
      title,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db.upsertTab(tab);
    return tab;
  }

  /** Updates a tab and increments its revision on navigation. */
  recordNavigation(tabId: string, url: string, title?: string): TabRecord {
    const tab = this.db.getTab(tabId);
    if (!tab) throw new RegistryError("Unknown tab");
    const next: TabRecord = {
      ...tab,
      url,
      title: title ?? tab.title,
      revision: tab.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.db.upsertTab(next);
    return next;
  }

  updateTabTitle(tabId: string, title: string): TabRecord {
    const tab = this.db.getTab(tabId);
    if (!tab) throw new RegistryError("Unknown tab");
    const next = { ...tab, title, updatedAt: new Date().toISOString() };
    this.db.upsertTab(next);
    return next;
  }

  closeTab(tabId: string): void {
    this.db.removeTab(tabId);
  }

  /** Primary page for a Bot (groupIndex 0); creates it if absent. */
  primaryTab(botId: string, fallbackUrl = "about:blank"): TabRecord {
    const existing = this.db.listTabs(botId);
    const primary = existing.find((tab) => tab.groupIndex === 0) ?? existing[0];
    if (primary) return primary;
    return this.createPrimaryTab(botId, fallbackUrl);
  }

  tabsForBot(botId: string): TabRecord[] {
    return this.db.listTabs(botId);
  }

  tabRevision(pageId: string): number | undefined {
    return this.db.getTab(pageId)?.revision;
  }

  allTabs(): TabRecord[] {
    return this.db.listTabs();
  }

  /** Restores a previously saved tab set after browser restart. */
  restoreTabs(botId: string, tabs: { url: string; title?: string }[]): TabRecord[] {
    this.closeAllTabs(botId);
    return tabs.map((tab, index) => {
      const now = new Date().toISOString();
      const record: TabRecord = {
        id: `tab-${cryptoRandom()}`,
        botId,
        groupIndex: index,
        url: tab.url,
        title: tab.title ?? "",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.db.upsertTab(record);
      return record;
    });
  }

  closeAllTabs(botId: string): void {
    for (const tab of this.db.listTabs(botId)) this.db.removeTab(tab.id);
  }
}

function cryptoRandom(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}