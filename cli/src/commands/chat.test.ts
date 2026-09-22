import { describe, expect, it } from "vitest";

import { buildRecentContext } from "./ask.js";
import { CHAT_COMMANDS, CHAT_HELP, CHAT_TIPS, osc52Copy, parseSlash, pickTip } from "./chat.js";
import { isModelArg } from "./input.js";

describe("chat helpers", () => {
  it("parses slash commands, defaulting to messages", () => {
    expect(parseSlash("hello there")).toEqual({ cmd: "message", text: "hello there" });
    expect(parseSlash("  /model opencode:big-pickle ")).toEqual({
      cmd: "model",
      arg: "opencode:big-pickle",
    });
    expect(parseSlash("/MODELS")).toEqual({ cmd: "models" });
    expect(parseSlash("/quit")).toEqual({ cmd: "exit" });
    expect(parseSlash("/copy")).toEqual({ cmd: "copy" });
    expect(parseSlash("/retry")).toEqual({ cmd: "retry" });
    expect(parseSlash("/save notes.md")).toEqual({ cmd: "save", arg: "notes.md" });
    expect(parseSlash("/save")).toEqual({ cmd: "save", arg: "" });
    expect(parseSlash("/bogus")).toEqual({ cmd: "unknown", arg: "bogus" });
    expect(parseSlash("   ")).toEqual({ cmd: "message", text: "" });
  });

  it("documents every slash command", () => {
    for (const cmd of ["/model", "/models", "/retry", "/copy", "/save", "/new", "/help", "/exit"]) {
      expect(CHAT_HELP).toContain(cmd);
    }
    expect(CHAT_COMMANDS.map((item) => item.command)).toEqual([
      "/model",
      "/models",
      "/retry",
      "/copy",
      "/save",
      "/new",
      "/help",
      "/exit",
    ]);
    // The <id> renders as a display hint, never a committed model value.
    expect(CHAT_COMMANDS[0]?.hint).toBe("<id>");
    expect(isModelArg(CHAT_COMMANDS[0]?.hint)).toBe(true);
  });

  it("rotates short tips", () => {
    expect(CHAT_TIPS.length).toBeGreaterThan(0);
    expect(CHAT_TIPS.every((tip) => tip.length > 0 && tip.length <= 80)).toBe(true);
    expect(CHAT_TIPS).toContain(pickTip());
  });

  it("caps recent context like the web client", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      author: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      body: `turn ${i} `.repeat(500),
    }));
    const capped = buildRecentContext(history);
    expect(capped).toHaveLength(8);
    expect(capped[0]?.body).toContain("turn 12");
    expect(capped.every((turn) => turn.body.length <= 2000)).toBe(true);
  });

  it("encodes OSC 52 clipboard writes that round-trip", () => {
    const seq = osc52Copy("hello ✓");
    expect(seq.startsWith("]52;c;")).toBe(true);
    expect(seq.endsWith("")).toBe(true);
    const payload = seq.slice("]52;c;".length, -1);
    expect(Buffer.from(payload, "base64").toString("utf8")).toBe("hello ✓");
  });
});
