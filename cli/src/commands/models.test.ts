import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import superjson from "superjson";

import type { CliProfile } from "../config.js";
import {
  defaultModelId,
  filterModels,
  groupModels,
  listModels,
  modelDisplay,
  providerForModelId,
  renderModels,
  type CatalogModel,
} from "./models.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
});

const catalog: CatalogModel[] = [
  { id: "openrouter/free", name: "Auto · Best available", provider: "OpenRouter", automatic: true },
  { id: "opencode:big-pickle", name: "Big Pickle", provider: "OpenCode" },
  { id: "chatgpt:gpt-5.5", name: "GPT 5.5", provider: "ChatGPT" },
];

describe("model catalog", () => {
  it("routes ids to providers like the web app", () => {
    expect(providerForModelId("chatgpt:gpt-5.5")).toBe("chatgpt");
    expect(providerForModelId("orcarouter:x/y")).toBe("orcarouter");
    expect(providerForModelId("tokenrouter:x")).toBe("tokenrouter");
    expect(providerForModelId("opencode:big-pickle")).toBe("opencode");
    expect(providerForModelId("openrouter/free")).toBe("openrouter");
  });

  it("groups opencode first with headers", () => {
    const groups = groupModels(catalog);
    expect(groups.map((group) => group.provider)).toEqual(["opencode", "openrouter", "chatgpt"]);
    const text = renderModels(catalog, false);
    expect(text).toContain("OPENCODE (1)");
    expect(text).toContain("big-pickle");
    expect(text).toContain("Auto");
  });

  it("renders json verbatim on request", () => {
    expect(JSON.parse(renderModels(catalog, true))).toHaveLength(3);
  });

  it("formats Claude-style model indicators", () => {
    expect(modelDisplay("opencode:big-pickle")).toBe("OpenCode Big Pickle");
    expect(modelDisplay("chatgpt:gpt-5.5")).toBe("ChatGPT Gpt 5.5");
    expect(modelDisplay("openrouter:anthropic/claude-opus-4.1")).toBe("OpenRouter Claude Opus 4.1");
  });

  it("defaults to openrouter/free, else first", () => {
    expect(defaultModelId(catalog)).toBe("openrouter/free");
    expect(defaultModelId([catalog[1]!])).toBe("opencode:big-pickle");
    expect(defaultModelId([])).toBeUndefined();
  });

  it("fetches the catalog and honors a snappy timeout budget", async () => {
    const profile: CliProfile = { apiUrl: "", token: "rook_test" };
    // Happy path: one GET, superjson envelope, models array unwrapped.
    server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          { result: { data: superjson.serialize({ models: catalog }) } },
        ]),
      );
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server!.address() as { port: number }).port;
    const models = await listModels({ ...profile, apiUrl: `http://127.0.0.1:${port}` });
    expect(models.map((m) => m.id)).toContain("openrouter/free");
    // A wedged server fails within the caller's budget (chat startup
    // passes 10s instead of hanging the terminal for the full 30s).
    const hanging = createServer(() => {
      /* never responds */
    });
    server = hanging;
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    const hangPort = (hanging.address() as { port: number }).port;
    await expect(
      listModels({ ...profile, apiUrl: `http://127.0.0.1:${hangPort}` }, { timeoutMs: 100 }),
    ).rejects.toThrow(/took too long|unreachable/);
  });

  it("filters by id, name, or provider substring", () => {
    expect(filterModels(catalog, "")).toHaveLength(3);
    expect(filterModels(catalog, "  ")).toHaveLength(3);
    expect(filterModels(catalog, "pickle").map((m) => m.id)).toEqual(["opencode:big-pickle"]);
    expect(filterModels(catalog, "GPT").map((m) => m.id)).toEqual(["chatgpt:gpt-5.5"]);
    expect(filterModels(catalog, "openrouter")).toHaveLength(1);
    expect(filterModels(catalog, "zzz")).toEqual([]);
    const text = renderModels(catalog, false, "pickle");
    expect(text).toContain("big-pickle");
    expect(text).not.toContain("GPT 5.5");
    expect(renderModels(catalog, false, "zzz")).toContain('No models match "zzz"');
    expect(JSON.parse(renderModels(catalog, true, "pickle"))).toHaveLength(1);
  });
});
