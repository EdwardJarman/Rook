import { describe, expect, it } from "vitest";

import { emptyWorkroomSnapshot, normalizeWorkroomSnapshot } from "../shared/workroom-snapshot";

describe("workroom cloud snapshots", () => {
  it("creates an honest blank snapshot for a new authenticated account", () => {
    expect(emptyWorkroomSnapshot()).toEqual({ selectedBotId: "", onboardingComplete: false, aiProvider: "openrouter", bots: [], messages: [], tasks: [], skills: [], routines: [], approvals: [], files: [], notifications: [], activity: [] });
  });

  it("keeps an existing selected Bot when normalizing stored data", () => {
    const snapshot = normalizeWorkroomSnapshot({ selectedBotId: "bot-one", onboardingComplete: true, bots: [{ id: "bot-one" }], messages: [{ id: "message-one" }], tasks: [] });
    expect(snapshot.selectedBotId).toBe("bot-one");
    expect(snapshot.bots).toEqual([{ id: "bot-one" }]);
    expect(snapshot.messages).toEqual([{ id: "message-one" }]);
  });

  it("falls back to an honest empty or first-Bot selection for malformed persisted values", () => {
    expect(normalizeWorkroomSnapshot({ selectedBotId: "missing", bots: [{ id: "bot-two" }], messages: "not-an-array" })).toMatchObject({ selectedBotId: "bot-two", messages: [] });
    expect(normalizeWorkroomSnapshot(null)).toEqual(emptyWorkroomSnapshot());
  });

  it("persists valid provider preferences and defaults old snapshots to OpenRouter", () => {
    expect(normalizeWorkroomSnapshot({ aiProvider: "chatgpt" }).aiProvider).toBe("chatgpt");
    expect(normalizeWorkroomSnapshot({ aiProvider: "orcarouter" }).aiProvider).toBe("orcarouter");
    expect(normalizeWorkroomSnapshot({ aiProvider: "tokenrouter" }).aiProvider).toBe("tokenrouter");
    expect(normalizeWorkroomSnapshot({ aiProvider: "unknown" }).aiProvider).toBe("openrouter");
    expect(normalizeWorkroomSnapshot({}).aiProvider).toBe("openrouter");
  });
});
