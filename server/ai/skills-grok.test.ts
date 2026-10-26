import { describe, expect, it } from "vitest";

import {
  invocableSlashCommands,
  parseSkillFile,
  resolveSlashName,
} from "./skills";

const withFlags = (flags: string): string =>
  `---\ndescription: Flagged skill\n${flags}---\n\nBody text here.`;

describe("grok skills-as-slash-commands", () => {
  it("parses invocation flags with safe defaults", () => {
    expect(parseSkillFile("a", withFlags(""))?.userInvocable).toBe(true);
    expect(parseSkillFile("a", withFlags(""))?.disableModelInvocation).toBe(false);
    expect(parseSkillFile("a", withFlags("user-invocable: false\n"))?.userInvocable).toBe(false);
    expect(
      parseSkillFile("a", withFlags("disable-model-invocation: true\n"))?.disableModelInvocation,
    ).toBe(true);
    expect(parseSkillFile("a", withFlags("user-invocable: nonsense\n"))?.userInvocable).toBe(true);
  });

  it("resolves bare names, qualifying only on collision", () => {
    expect(resolveSlashName("commit", ["new", "model"])).toEqual({ invocableAs: "commit" });
    expect(resolveSlashName("Compact", ["compact"])).toEqual({
      invocableAs: "library:compact",
      collidesWith: "compact",
    });
  });

  it("builds palette rows for invocable skills only", () => {
    const rows = invocableSlashCommands(
      [
        { id: "commit", description: "Commits", userInvocable: true },
        { id: "compact", description: "Compacts", userInvocable: true },
        { id: "hidden", description: "Hidden", userInvocable: false },
      ],
      ["compact"],
    );
    expect(rows.map((row) => row.invocableAs)).toEqual(["commit", "library:compact"]);
    expect(rows[1].collidesWith).toBe("compact");
    expect(rows.every((row) => row.scope === "library")).toBe(true);
  });
});
