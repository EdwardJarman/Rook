import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.js";
import { HELP_TOPICS, topicHelp } from "./help.js";

describe("per-command help", () => {
  it("resolves topics case-insensitively", () => {
    expect(topicHelp("ask")?.join("\n")).toContain("rook ask");
    expect(topicHelp("DOCTOR")?.join("\n")).toContain("rook doctor");
    expect(topicHelp("bogus")).toBeUndefined();
    expect(topicHelp(undefined)).toBeUndefined();
  });

  it("covers every routable command", () => {
    for (const command of ["login", "logout", "whoami", "models", "status", "doctor", "ask", "chat"]) {
      expect(HELP_TOPICS[command]?.length ?? 0).toBeGreaterThan(2);
    }
  });

  it("routes --help after a command to that topic", () => {
    expect(parseArgs(["ask", "--help"])).toEqual({
      command: "help",
      positionals: ["ask"],
      flags: {},
    });
    expect(parseArgs(["--help"])).toEqual({ command: "help", positionals: [], flags: {} });
    expect(parseArgs(["help", "doctor"])).toEqual({
      command: "help",
      positionals: ["doctor"],
      flags: {},
    });
  });
});
