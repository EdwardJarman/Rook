import { afterEach, expect, it, vi } from "vitest";
import path from "node:path";
import { attachedSkillBlock, executeSkillReadTool, listSkills } from "../server/ai/skills";

afterEach(() => vi.unstubAllEnvs());
it("loads the coding and research procedures from the real library through the same invocable skill path", async () => {
  vi.stubEnv("ROOK_SKILLS_DIR", path.join(process.cwd(), "skills"));
  const skills = await listSkills({ force: true });
  for (const id of ["plan-edit-verify", "multi-hop-research"]) {
    const skill = skills.find((entry) => entry.id === id)!;
    expect(skill.userInvocable).toBe(true);
    expect(skill.body.length).toBeLessThan(3000);
    const result = await executeSkillReadTool("read_skill", { skill: id });
    expect(result).toMatchObject({ status: "completed", result: { id, procedure: skill.body } });
    expect(await attachedSkillBlock([id])).toContain(skill.body);
  }
  expect(skills.find((s) => s.id === "plan-edit-verify")!.body).toContain("After substantive edits, read back");
  expect(skills.find((s) => s.id === "multi-hop-research")!.body).toContain("Label snippet-only findings clearly");
});
