import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const chatScreen = readFileSync(
  resolve(process.cwd(), "app/(tabs)/index.tsx"),
  "utf8",
);
const tabsLayout = readFileSync(
  resolve(process.cwd(), "app/(tabs)/_layout.tsx"),
  "utf8",
);
const desktopSidebar = readFileSync(
  resolve(process.cwd(), "components/rook-desktop-sidebar.tsx"),
  "utf8",
);
const sidebarState = readFileSync(
  resolve(process.cwd(), "lib/desktop-sidebar-state.tsx"),
  "utf8",
);

describe("desktop workroom composition", () => {
  it("keeps the normal slash Bot picker available outside the compact layout", () => {
    expect(chatScreen).toContain("{activeMention ? (");
    expect(chatScreen).not.toContain("isCompactLayout && activeMention");
    expect(chatScreen).toContain("matchingBotsForMention(bots, composer)");
    expect(chatScreen).toContain("onPress={() => handleMentionSelect(bot)}");
    expect(chatScreen).toContain("insertBotMention(current, bot.name)");
  });

  it("makes the desktop Bot panel closeable and restores the full stage when closed", () => {
    expect(sidebarState).toContain("visible: boolean");
    expect(sidebarState).toContain("hide: () => setVisible(false)");
    expect(sidebarState).toContain("show: () => setVisible(true)");
    expect(tabsLayout).toContain("isDesktopLayout && desktopSidebarVisible");
    expect(tabsLayout).toContain("? DESKTOP_STAGE_INSET");
    expect(chatScreen).toContain("!desktopSidebarVisible");
    expect(chatScreen).toContain("onPress={showDesktopSidebar}");
    expect(desktopSidebar).toContain(
      'accessibilityLabel="Close your Bots sidebar"',
    );
  });

  it("retains direct Bot selection, creation, and drag-to-chat on desktop", () => {
    expect(desktopSidebar).toContain("focusChatBot(botId)");
    expect(desktopSidebar).toContain("startNewChat()");
    expect(desktopSidebar).toContain("botDragSourceProps(bot");
    expect(desktopSidebar).toContain("Create a Bot");
  });
});
