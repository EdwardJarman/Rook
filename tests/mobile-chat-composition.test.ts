import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { insertBotMention, trailingBotMentionQuery } from "../lib/bot-mentions";
import { parseChatMarkdown } from "../lib/chat-markdown";

const chatScreen = readFileSync(
  resolve(process.cwd(), "app/(tabs)/index.tsx"),
  "utf8",
);
const participantStore = readFileSync(
  resolve(process.cwd(), "lib/bot-drag.tsx"),
  "utf8",
);

describe("compact workroom composition", () => {
  it("keeps multiline display math together for visual rendering", () => {
    expect(
      parseChatMarkdown(
        "Formula:\n\\[\nC = 2\\pi r\n\\]\nwhere r is the radius.",
      ),
    ).toEqual([
      { type: "paragraph", content: [{ text: "Formula:" }] },
      { type: "math", latex: "C = 2\\pi r" },
      { type: "paragraph", content: [{ text: "where r is the radius." }] },
    ]);
  });

  it("supports sequential slash mentions without leaving a stale picker open", () => {
    expect(trailingBotMentionQuery("Ask /a")).toEqual({ query: "a", start: 4 });
    expect(insertBotMention("Ask /a", "Atlas")).toBe("Ask /Atlas ");
    expect(trailingBotMentionQuery("Ask /Atlas ")).toBeNull();
    expect(trailingBotMentionQuery("Ask /Atlas then /be")).toEqual({
      query: "be",
      start: 16,
    });
  });

  it("uses the mobile drawer and preserves the clean-chat conversation boundary", () => {
    expect(chatScreen).toContain('label="Open your Bots"');
    expect(chatScreen).toContain("<MobileBotDrawer");
    expect(chatScreen).toContain("Type / to add a Bot");
    expect(chatScreen).toContain("conversationId: activeChatId");
    expect(participantStore).toContain("startNewChat");
    expect(participantStore).toContain("activeChatId");
  });
});
