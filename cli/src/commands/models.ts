/**
 * `rook models`: the same catalog the web app shows (it IS the web
 * catalog — one tRPC call, grouped by provider).
 */

import { trpc } from "../api.js";
import type { CliProfile } from "../config.js";
import { shortModel } from "../output.js";
import { bold, box, c } from "../ui.js";

export type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  automatic?: boolean;
  usageLabel?: string;
};

export type ProviderGroup = { provider: string; label: string; models: CatalogModel[] };

const PROVIDER_ORDER = ["opencode", "openrouter", "orcarouter", "tokenrouter", "chatgpt"] as const;

const PROVIDER_LABELS: Record<string, string> = {
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  orcarouter: "OrcaRouter",
  tokenrouter: "TokenRouter",
  chatgpt: "ChatGPT",
};

/** Prefix routing, mirroring lib/ai-provider.ts (kept local: CLI ships self-contained). */
export const providerForModelId = (id: string): string => {
  if (id.startsWith("chatgpt:")) return "chatgpt";
  if (id.startsWith("orcarouter:")) return "orcarouter";
  if (id.startsWith("tokenrouter:")) return "tokenrouter";
  if (id.startsWith("opencode:")) return "opencode";
  return "openrouter";
};

export async function listModels(profile: CliProfile): Promise<CatalogModel[]> {
  const data = await trpc<{ models: CatalogModel[] }>(profile, "ai.models", undefined, {
    timeoutMs: 30_000,
  });
  return data.models ?? [];
}

export function groupModels(models: CatalogModel[]): ProviderGroup[] {
  const groups: ProviderGroup[] = [];
  for (const provider of PROVIDER_ORDER) {
    const mine = models.filter((model) => providerForModelId(model.id) === provider);
    if (mine.length) {
      groups.push({ provider, label: PROVIDER_LABELS[provider] ?? provider, models: mine });
    }
  }
  const known = new Set(groups.flatMap((group) => group.models.map((model) => model.id)));
  const rest = models.filter((model) => !known.has(model.id));
  if (rest.length) groups.push({ provider: "other", label: "Other", models: rest });
  return groups;
}

export function renderModels(models: CatalogModel[], json: boolean): string {
  if (json) return JSON.stringify(models, null, 2);
  const groups = groupModels(models);
  if (!groups.length) return "No models available. Check the Rook server connection.";
  return groups
    .map((group) =>
      box({
        title: `${group.label.toUpperCase()} (${group.models.length})`,
        lines: group.models.map((model) => {
          const id = model.automatic ? "Auto" : shortModel(model.id);
          const name = model.automatic ? "Best available" : model.name || model.id;
          return `${bold(id.padEnd(28))}  ${c("dim", name)}`;
        }),
      }),
    )
    .join("\n\n");
}

/**
 * TUI model indicator (`OpenCode Big Pickle`, Claude-style): provider
 * label plus a humanized short id. Pure, unit-tested.
 */
export const modelDisplay = (id: string): string => {
  const provider = providerForModelId(id);
  const label = PROVIDER_LABELS[provider] ?? provider;
  const pretty = shortModel(id)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return pretty ? `${label} ${pretty}` : label;
};

/** Sensible default when -m is omitted: openrouter/free, else first. */
export const defaultModelId = (models: CatalogModel[]): string | undefined =>
  models.find((model) => model.id === "openrouter/free")?.id ?? models[0]?.id;
