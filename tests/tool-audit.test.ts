/** Reproducible static tool-schema audit. `ROOK_WRITE_TOOL_AUDIT=1` writes .cache/harness-evaluation/tool-audit.json. */
import { describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
vi.mock("../server/db", () => ({ listRookNodesForUser: vi.fn(async () => []) }));
import { allOfferedToolNames, orderToolset, TOOL_REGISTRY } from "../server/integrations/agent-tool-executor";
import { EXCEL_TOOLS } from "../server/integrations/excel-tools";
import { GITHUB_TOOLS } from "../server/integrations/github-tools";
import { COMPUTER_TOOLS } from "../server/integrations/computer-tools";
import { CLOUD_TOOLS } from "../server/integrations/cloud-tools";
import { SKILL_TOOLS } from "../server/ai/skills";
import { OUTPUT_TOOLS } from "../server/ai/tool-output";

const families = { excel: EXCEL_TOOLS, github: GITHUB_TOOLS, computer: COMPUTER_TOOLS, cloud: CLOUD_TOOLS, skills: SKILL_TOOLS, outputs: OUTPUT_TOOLS };

describe("tool schema audit", () => {
  it("accounts for every offered tool and measures serialized definition size", async () => {
    const rows = Object.entries(families).flatMap(([family, tools]) => tools.map((tool) => ({
      family, tool: tool.function.name, risk: TOOL_REGISTRY[tool.function.name].risk, chars: JSON.stringify(tool).length,
      descriptionChars: (tool.function.description ?? "").length,
    })));
    expect(rows.map((r) => r.tool).sort()).toEqual([...allOfferedToolNames()].sort());
    const all = orderToolset(families);
    const totals = Object.fromEntries(Object.entries(families).map(([f, t]) => [f, JSON.stringify(t).length]));
    expect(JSON.stringify(all).length).toBeGreaterThan(Object.values(totals).reduce((a, b) => a + b, 0) - 10);
    expect(rows.every((r) => r.chars > 0 && r.descriptionChars > 20)).toBe(true);
    if (process.env.ROOK_WRITE_TOOL_AUDIT === "1") {
      const folder = path.join(process.cwd(), ".cache", "harness-evaluation");
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "tool-audit.json"), JSON.stringify({ totals, allConnectedChars: JSON.stringify(all).length, rows }, null, 2));
    }
  });
});
