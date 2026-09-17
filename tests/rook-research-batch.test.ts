import { describe, expect, it } from "vitest";

import { buildRookSystemPrompt } from "../server/ai/system-prompt";
import { buildCheckpointLedger } from "../server/ai/compaction";
import { partitionRecentContext } from "../server/ai/agent-reliability";
import {
  TOOL_RISK,
  allOfferedToolNames,
  orderToolset,
} from "../server/integrations/agent-tool-executor";
import {
  COMPUTER_TOOLS,
  COMPUTER_TOOL_NAMES,
} from "../server/integrations/computer-tools";
import { EXCEL_TOOLS } from "../server/integrations/excel-tools";
import { GITHUB_TOOLS, GITHUB_TOOL_NAMES } from "../server/integrations/github-tools";

const promptInput = (overrides: Record<string, unknown> = {}) => ({
  botName: "Scout",
  botRole: "researcher",
  botPurpose: "Track launches.",
  modelRoute: "openrouter/free",
  clockLocal: "Monday, 01 September 2026, 10:00:00",
  clockTimeZone: "UTC",
  clockIso: "2026-09-01T10:00:00.000Z",
  capabilities: {
    computer: "No Rook Node computer is paired.",
    excel: "Excel not connected.",
    github: "GitHub not connected.",
    web: "Web search available.",
  },
  ...overrides,
});

describe("static-first prompt layout (prefix-cache safe)", () => {
  it("keeps the standing rules byte-identical when only volatile facts change", () => {
    const first = buildRookSystemPrompt(promptInput());
    const second = buildRookSystemPrompt(
      promptInput({
        clockLocal: "Tuesday, 02 September 2026, 15:30:00",
        clockIso: "2026-09-02T15:30:00.000Z",
        capabilities: {
          computer: "A Rook Node shared computer IS paired and ONLINE.",
          excel: "Excel connected.",
          github: "GitHub connected.",
          web: "Web search available.",
        },
        extraContext: "memory: prefers concise answers",
      }),
    );
    const liveMarker = "## Live context";
    const firstStable = first.slice(0, first.indexOf(liveMarker));
    const secondStable = second.slice(0, second.indexOf(liveMarker));
    expect(firstStable).toBe(secondStable);
    expect(firstStable.length).toBeGreaterThan(2000);
  });

  it("orders stable rules before live context, clock trailing", () => {
    const prompt = buildRookSystemPrompt(promptInput());
    const rulesAt = prompt.indexOf("## How you work");
    const disciplinesAt = prompt.indexOf("## Tool-use disciplines");
    const liveAt = prompt.indexOf("## Live context");
    const clockAt = prompt.indexOf("Clock:");
    expect(rulesAt).toBeGreaterThan(-1);
    expect(disciplinesAt).toBeGreaterThan(rulesAt);
    expect(liveAt).toBeGreaterThan(disciplinesAt);
    expect(clockAt).toBeGreaterThan(liveAt);
  });

  it("still reports the model route and delimits identity", () => {
    const prompt = buildRookSystemPrompt(promptInput());
    expect(prompt).toMatch(/openrouter\/free/);
    expect(prompt).toContain("<bot_identity>");
  });
});

describe("frozen tool order (cache-safe registry)", () => {
  it("orders families Excel, then GitHub, then computer", () => {
    const ordered = orderToolset({
      excel: EXCEL_TOOLS,
      github: GITHUB_TOOLS,
      computer: COMPUTER_TOOLS,
    }).map((tool) => tool.function.name);
    expect(ordered.slice(0, 8)).toEqual(EXCEL_TOOLS.map((tool) => tool.function.name));
    expect(ordered.slice(8, 11)).toEqual(GITHUB_TOOLS.map((tool) => tool.function.name));
    expect(ordered.slice(11)).toEqual(COMPUTER_TOOLS.map((tool) => tool.function.name));
  });

  it("annotates every offered tool with an honest risk tier, and nothing else", () => {
    const offered = allOfferedToolNames();
    // 13 families + read_skill (appended deliberately for the skills loop)
    // + 4 cloud computer tools (appended merging origin/main; see
    // orderToolset cache-bust note in agent-tool-executor.ts).
    expect(offered).toHaveLength(18);
    for (const name of offered) {
      expect(
        TOOL_RISK[name as keyof typeof TOOL_RISK],
        `${name} lacks a risk annotation`,
      ).toMatch(/read-only|approval-gated/);
    }
    expect(Object.keys(TOOL_RISK).sort()).toEqual([...offered].sort());
  });

  it("marks only approval-gated tools as non-read-only", () => {
    const gated = Object.entries(TOOL_RISK)
      .filter(([, risk]) => risk === "approval-gated")
      .map(([name]) => name)
      .sort();
    expect(gated).toEqual(
      [
        "computer_propose_task",
        "computer_run_command",
        "computer_write_file",
        "excel_add_worksheet",
        "excel_append_table_rows",
        "excel_create_workbook",
        "excel_update_range",
      ].sort(),
    );
    // Read tools really are side-effect free at the dispatcher level.
    expect(GITHUB_TOOL_NAMES.has("github_read_file")).toBe(true);
    expect(COMPUTER_TOOL_NAMES.has("computer_status")).toBe(true);
  });
});

describe("checkpoint ledger (no silent history loss)", () => {
  it("returns empty when nothing was dropped", () => {
    expect(buildCheckpointLedger([])).toBe("");
    const { kept, dropped } = partitionRecentContext(
      [{ body: "a" }, { body: "b" }],
      6000,
    );
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(2);
  });

  it("condenses dropped turns into capped, newest-biased lines", () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      author: (i % 2 === 0 ? "user" : "bot") as "user" | "bot",
      body: `message number ${i} with enough padding to cost tokens `.repeat(20),
    }));
    const { kept, dropped } = partitionRecentContext(entries, 2000);
    expect(dropped.length).toBeGreaterThan(0);
    expect(kept.length).toBeGreaterThan(0);
    const ledger = buildCheckpointLedger(dropped);
    expect(ledger).toMatch(/condensed/);
    expect(ledger.split("\n").length).toBeLessThanOrEqual(13);
    expect(ledger.length).toBeLessThanOrEqual(1200);
    // Newest dropped turn survives (slice from the end).
    expect(ledger).toContain(`message number ${entries.length - kept.length - 1}`);
  });
});
