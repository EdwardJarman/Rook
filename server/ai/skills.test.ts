import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetSkillsForTests,
  attachedSkillBlock,
  executeSkillReadTool,
  getSkill,
  listSkills,
  parseSkillFile,
  parseSkillToolArguments,
  skillCatalogBlock,
  SKILL_TOOLS,
} from "./skills";

const SKILL_A = `---
name: Alpha Skill
description: Does alpha things on demand
---

# Alpha

Always start with the letter A. Verify by reading twice.
`;

const SKILL_B = `---
name: beta-skill
description: Does beta things quietly
---

# Beta

End every answer with a period. Never guess acronyms.
`;

const setupLibrary = () => {
  const dir = mkdtempSync(join(tmpdir(), "rook-skills-"));
  mkdirSync(join(dir, "alpha-skill"));
  writeFileSync(join(dir, "alpha-skill", "SKILL.md"), SKILL_A);
  mkdirSync(join(dir, "beta-skill"));
  writeFileSync(join(dir, "beta-skill", "SKILL.md"), SKILL_B);
  mkdirSync(join(dir, "broken-skill"));
  writeFileSync(join(dir, "broken-skill", "SKILL.md"), "no frontmatter here");
  mkdirSync(join(dir, "empty-skill"));
  mkdirSync(join(dir, "Bad Name"));
  writeFileSync(join(dir, "Bad Name", "SKILL.md"), SKILL_A);
  vi.stubEnv("ROOK_SKILLS_DIR", dir);
  __resetSkillsForTests();
  return dir;
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetSkillsForTests();
  delete process.env.ROOK_SKILLS_DIR;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  __resetSkillsForTests();
  delete process.env.ROOK_SKILLS_DIR;
});

describe("parseSkillFile", () => {
  it("parses name, description, and body", () => {
    expect(parseSkillFile("alpha-skill", SKILL_A)).toEqual({
      name: "Alpha Skill",
      description: "Does alpha things on demand",
      body: "# Alpha\n\nAlways start with the letter A. Verify by reading twice.",
    });
  });

  it("rejects missing frontmatter, missing fields, and bad ids", () => {
    expect(parseSkillFile("x", "plain text")).toBeNull();
    expect(parseSkillFile("x", "---\nname: X\n---\n\nbody")).toBeNull();
    expect(parseSkillFile("x", "---\ndescription: d\n---\n\n")).toBeNull();
    expect(parseSkillFile("Bad Name", SKILL_A)).toBeNull();
    expect(parseSkillFile("", SKILL_A)).toBeNull();
  });
});

describe("skill registry", () => {
  it("lists valid skills and skips broken folders", async () => {
    setupLibrary();
    const skills = await listSkills();
    expect(skills.map((skill) => skill.id)).toEqual(["alpha-skill", "beta-skill"]);
  });

  it("returns empty when the library dir is missing", async () => {
    vi.stubEnv("ROOK_SKILLS_DIR", join(tmpdir(), "rook-skills-does-not-exist"));
    __resetSkillsForTests();
    expect(await listSkills()).toEqual([]);
  });

  it("catalogs descriptions without bodies", async () => {
    setupLibrary();
    const block = await skillCatalogBlock();
    expect(block).toContain("alpha-skill: Does alpha things on demand");
    expect(block).toContain("read_skill");
    expect(block).not.toContain("Verify by reading twice");
  });

  it("injects full bodies only for attached, known skills", async () => {
    setupLibrary();
    const block = await attachedSkillBlock(["beta-skill", "nope-missing", "beta-skill"]);
    expect(block).toContain("End every answer with a period");
    expect(block).not.toContain("nope-missing");
    expect(await attachedSkillBlock([])).toBe("");
    expect(await attachedSkillBlock(undefined)).toBe("");
  });

  it("resolves single skills case-insensitively", async () => {
    setupLibrary();
    expect((await getSkill("Alpha-Skill"))?.name).toBe("Alpha Skill");
    expect(await getSkill("missing")).toBeUndefined();
    expect(await getSkill("../escape")).toBeUndefined();
  });
});

describe("read_skill tool", () => {
  it("is a single read-only tool", () => {
    expect(SKILL_TOOLS.map((tool) => tool.function.name)).toEqual(["read_skill"]);
  });

  it("parses and validates arguments", () => {
    expect(parseSkillToolArguments("read_skill", '{"skill":"alpha-skill"}')).toEqual({
      skill: "alpha-skill",
    });
    expect(() => parseSkillToolArguments("read_skill", "nope")).toThrow(/valid JSON/);
    expect(() => parseSkillToolArguments("read_skill", "{}")).toThrow(/Invalid arguments/);
  });

  it("returns the procedure or an honest miss", async () => {
    setupLibrary();
    const hit = (await executeSkillReadTool("read_skill", { skill: "alpha-skill" })) as {
      status: string;
      result: { procedure: string };
    };
    expect(hit.status).toBe("completed");
    expect(hit.result.procedure).toContain("Verify by reading twice");
    const miss = (await executeSkillReadTool("read_skill", { skill: "ghost" })) as {
      status: string;
    };
    expect(miss.status).toBe("error");
  });
});

describe("skill turn wiring", () => {
  it("injects attached procedures and offers read_skill", async () => {
    setupLibrary();
    const { prepareAgentTurn } = await import("../integrations/excel-agent");
    const turn = await prepareAgentTurn(
      {
        userId: "user-1",
        botId: "bot-1",
        taskId: "task-1",
        botName: "Scout",
        botRole: "researcher",
        botPurpose: "Track launches.",
        message: "Is this broken?",
        recentContext: [],
        skillIds: ["alpha-skill", "ghost-skill"],
      },
      "request-1",
    );
    const system = String(turn.messages[0]?.content ?? "");
    expect(system).toContain("Verify by reading twice");
    expect(system).not.toContain("ghost-skill");
    expect(system).toContain("beta-skill: Does beta things quietly");
    expect(turn.tools?.map((tool) => tool.function.name)).toContain("read_skill");
  });

  it("leaves turns untouched when nothing is attached", async () => {
    setupLibrary();
    const { prepareAgentTurn } = await import("../integrations/excel-agent");
    const turn = await prepareAgentTurn(
      {
        userId: "user-1",
        botId: "bot-1",
        taskId: "task-1",
        botName: "Scout",
        botRole: "researcher",
        botPurpose: "Track launches.",
        message: "Say hello.",
        recentContext: [],
      },
      "request-2",
    );
    const system = String(turn.messages[0]?.content ?? "");
    expect(system).not.toContain("Verify by reading twice");
    expect(system).toContain("read_skill");
  });
});
