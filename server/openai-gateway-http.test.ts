import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";

import type { InvokeResult } from "./_core/llm";
import { GATEWAY_BASE_PATH, registerOpenAiGatewayRoutes } from "./openai-gateway-routes";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    server = undefined;
  });
});

const result = (): InvokeResult => ({
  id: "gen-live",
  created: 1700000002,
  model: "openrouter/free",
  choices: [{ index: 0, message: { role: "assistant", content: "live ok" }, finish_reason: "stop" }],
});

const boot = async (): Promise<string> =>
  new Promise((resolve) => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    registerOpenAiGatewayRoutes(app, {
      auth: async (req) =>
        req.headers.authorization === "Bearer rook_test" ? { id: "cli:test" } : null,
      listModels: async () => [{ id: "openrouter/free" }],
      invoke: async (params) => ({
        result: { ...result(), model: params.model ?? "openrouter/free" },
        attemptedProviders: ["openrouter"],
        fellBack: false,
      }),
    });
    server = app.listen(0, "127.0.0.1", () => {
      const port = (server!.address() as { port: number }).port;
      resolve(`http://127.0.0.1:${port}${GATEWAY_BASE_PATH}`);
    });
  });

describe("gateway over real HTTP", () => {
  it("serves models and completions end to end", async () => {
    const base = await boot();
    const unauth = await fetch(`${base}/models`);
    expect(unauth.status).toBe(401);

    const headers = { authorization: "Bearer rook_test", "content-type": "application/json" };
    const models = await (await fetch(`${base}/models`, { headers })).json() as {
      object: string;
      data: Array<{ id: string }>;
    };
    expect(models.object).toBe("list");
    expect(models.data.map((entry) => entry.id)).toEqual(["openrouter/free"]);

    const completion = await (
      await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: "openrouter/free", messages: [{ role: "user", content: "hi" }] }),
      })
    ).json() as { object: string; choices: Array<{ message: { content: string } }> };
    expect(completion.object).toBe("chat.completion");
    expect(completion.choices[0]?.message.content).toBe("live ok");
  });

  it("streams SSE with a [DONE] terminator", async () => {
    const base = await boot();
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: "Bearer rook_test", "content-type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }], stream: true }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"content":"live ok"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});
