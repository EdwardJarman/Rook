/** `rook status`: provider health, same source as Account → AI backend. */

import { trpc } from "../api.js";
import type { CliProfile } from "../config.js";
import { renderTable } from "../output.js";

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
      const status = await trpc<ProviderStatus>(profile, "ai.status", { provider });
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
  return renderTable([
    ["PROVIDER", "STATE", "MODELS", "NOTE"],
    ...statuses.map((status) => [
      status.provider,
      status.operational ? "Online" : status.configured ? "Attention" : "Setup",
      String(status.freeModels),
      status.message.slice(0, 72),
    ]),
  ]);
}
