import { describe, expect, it } from "vitest";

import {
  allOfferedToolNames,
  orderToolset,
  timeoutForTool,
  TOOL_REGISTRY,
  TOOL_RISK,
} from "../server/integrations/agent-tool-executor";

describe("grok tool registry (centralized timeouts + risk)", () => {
  it("covers every offered tool with matching risk", () => {
    const offered = allOfferedToolNames();
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...offered].sort());
    for (const name of offered) {
      expect(TOOL_REGISTRY[name].risk).toBe(
        TOOL_RISK[name as keyof typeof TOOL_RISK],
      );
    }
  });

  it("assigns families per the frozen order", () => {
    expect(TOOL_REGISTRY.excel_read_range.family).toBe("excel");
    expect(TOOL_REGISTRY.github_read_file.family).toBe("github");
    expect(TOOL_REGISTRY.computer_status.family).toBe("computer");
    expect(TOOL_REGISTRY.computer_read_file.family).toBe("cloud");
    expect(TOOL_REGISTRY.read_skill.family).toBe("skill");
  });

  it("keeps the current execution timeouts (20s reads, 10s status/skill)", () => {
    expect(timeoutForTool("github_read_file")).toBe(20_000);
    expect(timeoutForTool("excel_read_range")).toBe(20_000);
    expect(timeoutForTool("computer_read_file")).toBe(20_000);
    expect(timeoutForTool("computer_status")).toBe(10_000);
    expect(timeoutForTool("read_skill")).toBe(10_000);
  });

  it("gives proposal-only tools no in-turn timeout", () => {
    expect(timeoutForTool("excel_update_range")).toBeUndefined();
    expect(timeoutForTool("computer_propose_task")).toBeUndefined();
    expect(timeoutForTool("computer_run_command")).toBeUndefined();
    expect(timeoutForTool("computer_write_file")).toBeUndefined();
    expect(timeoutForTool("no_such_tool")).toBeUndefined();
  });

  it("leaves the frozen tool-family order untouched", () => {
    const ordered = orderToolset({
      excel: [{ function: { name: "e" } } as never],
      github: [{ function: { name: "g" } } as never],
      computer: [{ function: { name: "c" } } as never],
      cloud: [{ function: { name: "d" } } as never],
      skills: [{ function: { name: "s" } } as never],
    });
    expect(ordered.map((tool) => tool.function.name)).toEqual([
      "e",
      "g",
      "c",
      "d",
      "s",
    ]);
  });
});
