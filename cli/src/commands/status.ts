/** `rook status`: provider health, same source as Account → AI backend. */

import { trpc } from "../api.js";
import type { CliProfile } from "../config.js";
import { box, c } from "../ui.js";

const PROVIDERS = ["opencode", "openrouter", "orcarouter", "tokenrouter"] as const;

export type ProviderStatus = {
  provider: string;
  configured: boolean;
  operational: boolean;
  freeModels: number;
  message: string;
};

export async function providerStatuses(profile: CliProfile): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const provider of PROVIDERS) {
    try {
      const status = await trpc<ProviderStatus>(
        profile,
        "ai.status",
        { provider },
        { timeoutMs: 30_000 },
      );
      out.push(status);
    } catch (error) {
      out.push({
        provider,
        configured: false,
        operational: false,
        freeModels: 0,
        message: error instanceof Error ? error.message : "Status check failed.",
      });
    }
  }
  return out;
}

export function renderStatus(statuses: ProviderStatus[], json: boolean): string {
  if (json) return JSON.stringify(statuses, null, 2);
  if (!statuses.length) return "No provider status. Check the Rook server connection.";
  return box({
    title: "Providers",
    lines: statuses.map((status) => {
      const state = status.operational
        ? c("mint", "● Online   ")
        : status.configured
          ? c("amber", "● Attention")
          : c("dim", "○ Setup    ");
      const models =
        status.freeModels > 0 ? c("dim", `${status.freeModels} models`) : c("dim", "no models");
      return `${state}  ${status.provider.padEnd(11)} ${models}`;
    }),
  });
}
