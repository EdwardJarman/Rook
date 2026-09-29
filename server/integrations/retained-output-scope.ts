/**
 * Read-time authorization for retained tool outputs.
 *
 * Storage is already keyed to owner + Bot. This adds the connector scopes the
 * producing tool needed: an output is readable only while its source would
 * still be usable now (tool not denied for the Bot, connector still linked,
 * repo still in the working set, account still connected, computer still
 * reachable). Unknown sources and status-lookup failures deny.
 */

import type { OutputSource } from "../ai/tool-output";
import { SKILL_TOOL_NAMES } from "../ai/skills";
import { resolveComputerTarget } from "./cloud-computer";
import { CLOUD_TOOL_NAMES } from "./cloud-tools";
import { COMPUTER_TOOL_NAMES } from "./computer-tools";
import { EXCEL_TOOLS } from "./excel-tools";
import { githubConnectionStatus } from "./github";
import { GITHUB_TOOL_NAMES } from "./github-tools";
import { microsoftConnectionStatus } from "./microsoft-excel";

const EXCEL_TOOL_NAMES = new Set(EXCEL_TOOLS.map((tool) => tool.function.name));

export type RetainedScopeDeps = {
  excelStatus: (userId: string) => Promise<{ connected: boolean; accounts: Array<{ accountId: string; status: string }> }>;
  githubStatus: (userId: string) => Promise<{ connected: boolean; selectedRepos: Array<{ fullName: string }> }>;
  computerTarget: (userId: string) => Promise<{ kind: string }>;
};

const realDeps: RetainedScopeDeps = {
  excelStatus: microsoftConnectionStatus,
  githubStatus: githubConnectionStatus,
  computerTarget: resolveComputerTarget,
};

/** The resource a read tool touched (GitHub repo, Excel account), taken from its raw arguments. */
export function retainedOutputResource(name: string, rawArgs: string): string | undefined {
  try {
    const args = JSON.parse(rawArgs || "{}") as Record<string, unknown>;
    const value = GITHUB_TOOL_NAMES.has(name) ? args.repo : EXCEL_TOOL_NAMES.has(name) ? args.account_id : undefined;
    return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function retainedOutputAuthorizer(
  input: { userId: string; disallowedTools?: readonly string[] },
  deps: RetainedScopeDeps = realDeps,
): (source: OutputSource) => Promise<boolean> {
  return async (source) => {
    if (input.disallowedTools?.includes(source.tool)) return false;
    try {
      if (SKILL_TOOL_NAMES.has(source.tool)) return true;
      if (EXCEL_TOOL_NAMES.has(source.tool)) {
        const status = await deps.excelStatus(input.userId);
        if (!status.connected) return false;
        return !source.resource || status.accounts.some((a) => a.accountId.toLowerCase() === source.resource && a.status === "connected");
      }
      if (GITHUB_TOOL_NAMES.has(source.tool)) {
        const status = await deps.githubStatus(input.userId);
        if (!status.connected) return false;
        return status.selectedRepos.some((repo) =>
          source.resource ? repo.fullName.toLowerCase() === source.resource : true);
      }
      if (COMPUTER_TOOL_NAMES.has(source.tool) || CLOUD_TOOL_NAMES.has(source.tool)) {
        return (await deps.computerTarget(input.userId)).kind !== "none";
      }
    } catch {
      return false;
    }
    return false;
  };
}
