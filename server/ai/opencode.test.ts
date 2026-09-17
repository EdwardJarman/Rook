import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  collectOpenCodeFiles,
  extractArtifactPaths,
  invokeOpenCode,
  isOpenCodeModel,
  listOpenCodeModels,
  opencodeStatus,
  promptTextFor,
  OPENCODE_DEFAULT_MODEL,
} from "./opencode";
import { fallbackCandidates } from "./fallback-router";

const BASE = "http://127.0.0.1:4123";

type Route = { method: string; path: string; respond: () => unknown };

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const mockFetchRoutes = (routes: Route[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
      const route = routes.find((r) => r.method === method && r.path === path);
      if (!route) throw new Error(`unexpected fetch ${method} ${path}`);
      return jsonResponse(route.respond());
    }),
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENCODE_BASE_URL;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_USERNAME;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OPENCODE_BASE_URL;
  delete process.env.OPENCODE_SERVER_PASSWORD;
  delete process.env.OPENCODE_SERVER_USERNAME;
});

describe("opencode catalog gating", () => {
  it("lists nothing until OPENCODE_BASE_URL is set", () => {
    expect(listOpenCodeModels()).toEqual([]);
  });

  it("lists curated free models with big-pickle first once configured", () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const models = listOpenCodeModels();
    expect(models.length).toBeGreaterThanOrEqual(5);
    expect(models[0]?.id).toBe("opencode:big-pickle");
    expect(models[0]?.id).toBe(OPENCODE_DEFAULT_MODEL);
    expect(models.every((m) => m.id.startsWith("opencode:"))).toBe(true);
  });

  it("validates model ids against the curated list", () => {
    expect(isOpenCodeModel("opencode:big-pickle")).toBe(true);
    expect(isOpenCodeModel("opencode:nope-not-real")).toBe(false);
    expect(isOpenCodeModel("openrouter/free")).toBe(false);
    expect(isOpenCodeModel(undefined)).toBe(false);
  });
});

describe("promptTextFor", () => {
  it("joins system and user text, skipping assistant turns", () => {
    const text = promptTextFor([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: [{ type: "text", text: "Reply OK" }] },
    ]);
    expect(text).toBe("Be brief.\n\nHello\n\nReply OK");
  });

  it("throws when there is no sendable text", () => {
    expect(() => promptTextFor([{ role: "assistant", content: "Hi" }])).toThrow(
      /no message text/i,
    );
  });
});

describe("invokeOpenCode", () => {
  const historyDone = () => ({
    data: [
      { type: "session.next.step.started", data: { assistantMessageID: "msg_a1" } },
      { type: "session.next.step.ended", data: {} },
    ],
  });
  const messageDone = () => ({
    data: {
      content: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "ROOK_E2E_OK" },
      ],
      finish: "stop",
      tokens: { input: 10, output: 3 },
      time: { completed: 123 },
    },
  });

  it("runs session -> prompt -> poll -> message and returns the answer", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    mockFetchRoutes([
      { method: "POST", path: "/api/session", respond: () => ({ data: { id: "ses_1" } }) },
      {
        method: "POST",
        path: "/api/session/ses_1/prompt",
        respond: () => ({ data: { id: "msg_1" } }),
      },
      { method: "GET", path: "/api/session/ses_1/history", respond: historyDone },
      { method: "GET", path: "/api/session/ses_1/message/msg_a1", respond: messageDone },
    ]);
    const result = await invokeOpenCode({
      messages: [{ role: "user", content: "Reply ROOK_E2E_OK" }],
      model: "opencode:big-pickle",
    });
    expect(result.model).toBe("opencode:big-pickle");
    expect(result.choices[0]?.message.content).toBe("ROOK_E2E_OK");
    expect(result.choices[0]?.finish_reason).toBe("stop");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
  });

  it("rejects unknown opencode models before any network call", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const spy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", spy);
    await expect(
      invokeOpenCode({ messages: [{ role: "user", content: "hi" }], model: "opencode:nope" }),
    ).rejects.toThrow(/not available in Rook/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces bad credentials as a needs-attention error", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    process.env.OPENCODE_SERVER_PASSWORD = "wrong";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized" }) as unknown as Response),
    );
    await expect(
      invokeOpenCode({ messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" }),
    ).rejects.toThrow(/needs attention/);
  });

  it("reports an unreachable server honestly", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(
      invokeOpenCode({ messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" }),
    ).rejects.toThrow(/unreachable/);
  });

  it("requires configuration before dialing", async () => {
    const spy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", spy);
    await expect(
      invokeOpenCode({ messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" }),
    ).rejects.toThrow(/not connected|OPENCODE_BASE_URL/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("multi-step turns idle out instead of stopping at the first step", () => {
  it("waits through a second step and answers from the latest message", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const histories = [
      // Poll 1: first step running.
      { data: [{ type: "session.next.step.started", data: { assistantMessageID: "msg_a" } }] },
      // Poll 2: first step ended, second step started — must NOT finish here.
      {
        data: [
          { type: "session.next.step.started", data: { assistantMessageID: "msg_a" } },
          { type: "session.next.step.ended", data: {} },
          { type: "session.next.step.started", data: { assistantMessageID: "msg_b" } },
        ],
      },
      // Polls 3+: second step ended, history stable → idle out.
      {
        data: [
          { type: "session.next.step.started", data: { assistantMessageID: "msg_a" } },
          { type: "session.next.step.ended", data: {} },
          { type: "session.next.step.started", data: { assistantMessageID: "msg_b" } },
          { type: "session.next.step.ended", data: {} },
        ],
      },
    ];
    let historyCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        if (method === "POST" && path === "/api/session") {
          return jsonResponse({ data: { id: "ses_m" } });
        }
        if (method === "POST" && path === "/api/session/ses_m/prompt") {
          return jsonResponse({ data: { id: "msg_m" } });
        }
        if (method === "GET" && path === "/api/session/ses_m/history") {
          historyCalls += 1;
          const index = Math.min(historyCalls - 1, histories.length - 1);
          return jsonResponse(histories[index]);
        }
        if (method === "GET" && path === "/api/session/ses_m/message/msg_b") {
          return jsonResponse({
            data: {
              content: [{ type: "text", text: "FINAL_AFTER_TWO_STEPS" }],
              finish: "stop",
              tokens: { input: 9, output: 9 },
              time: { completed: 3 },
            },
          });
        }
        if (method === "GET" && path === "/api/event") throw new Error("no sse in unit test");
        throw new Error(`unexpected fetch ${method} ${path}`);
      }),
    );
    const result = await invokeOpenCode(
      { messages: [{ role: "user", content: "do a long task" }], model: "opencode:big-pickle" },
    );
    expect(result.choices[0]?.message.content).toBe("FINAL_AFTER_TWO_STEPS");
    // Proves we kept polling past the first step.ended (polls 1-2) instead
    // of answering early: idle-out needs 3 quiet polls after the last change.
    expect(historyCalls).toBeGreaterThanOrEqual(5);
  }, 30000);

  it("surfaces a permission stall honestly instead of hanging", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    process.env.OPENCODE_STALL_AFTER_MS = "50";
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const method = (init?.method ?? "GET").toUpperCase();
          const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
          if (method === "POST" && path === "/api/session") {
            return jsonResponse({ data: { id: "ses_s" } });
          }
          if (method === "POST" && path === "/api/session/ses_s/prompt") {
            return jsonResponse({ data: { id: "msg_s" } });
          }
          if (method === "GET" && path === "/api/session/ses_s/history") {
            return jsonResponse({
              data: [{ type: "session.next.step.started", data: { assistantMessageID: "msg_sa" } }],
            });
          }
          if (method === "GET" && path === "/api/session/ses_s/permission") {
            return jsonResponse({ data: [{ title: "Run `rm -rf /tmp/x`" }] });
          }
          if (method === "GET" && path === "/api/event") throw new Error("no sse in unit test");
          throw new Error(`unexpected fetch ${method} ${path}`);
        }),
      );
      await expect(
        invokeOpenCode(
          { messages: [{ role: "user", content: "delete stuff" }], model: "opencode:big-pickle" },
        ),
      ).rejects.toThrow(/permission decision/);
    } finally {
      delete process.env.OPENCODE_STALL_AFTER_MS;
    }
  }, 30000);

  it("budgets very long turns via OPENCODE_TURN_TIMEOUT_MS", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    process.env.OPENCODE_TURN_TIMEOUT_MS = "2500";
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          const method = (init?.method ?? "GET").toUpperCase();
          const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
          if (method === "POST" && path === "/api/session") {
            return jsonResponse({ data: { id: "ses_t" } });
          }
          if (method === "POST" && path === "/api/session/ses_t/prompt") {
            return jsonResponse({ data: { id: "msg_t" } });
          }
          if (method === "GET" && path === "/api/session/ses_t/history") {
            return jsonResponse({
              data: [{ type: "session.next.step.started", data: { assistantMessageID: "msg_ta" } }],
            });
          }
          if (method === "GET" && path === "/api/event") throw new Error("no sse in unit test");
          throw new Error(`unexpected fetch ${method} ${path}`);
        }),
      );
      await expect(
        invokeOpenCode(
          { messages: [{ role: "user", content: "take forever" }], model: "opencode:big-pickle" },
        ),
      ).rejects.toThrow(/past the turn budget/);
    } finally {
      delete process.env.OPENCODE_TURN_TIMEOUT_MS;
    }
  }, 30000);
});

describe("extractArtifactPaths", () => {
  it("finds windows and posix paths, dedupes, strips punctuation", () => {
    const paths = extractArtifactPaths(
      "Open C:\\Users\\you\\game\\flappy-bird.html, or /tmp/demo/app.py. Again C:\\Users\\you\\game\\flappy-bird.html!",
    );
    expect(paths).toEqual([
      "C:\\Users\\you\\game\\flappy-bird.html",
      "/tmp/demo/app.py",
    ]);
  });

  it("ignores non-artifact extensions and bare words", () => {
    expect(extractArtifactPaths("Run restart.exe then check C:\\a\\b.dll and notes")).toEqual([]);
    expect(extractArtifactPaths("see config.json and data.csv")).toEqual([]);
    expect(extractArtifactPaths("see /srv/config.json and /srv/data.csv")).toEqual([
      "/srv/config.json",
      "/srv/data.csv",
    ]);
  });
});

describe("collectOpenCodeFiles", () => {
  it("reads named files with names and mime types", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === `${BASE}/api/fs/read/C:/game/flappy.html`) {
          return new Response("<html>game</html>", {
            headers: { "content-type": "text/html" },
          });
        }
        return { ok: false, status: 404, body: { cancel: async () => undefined } } as unknown as Response;
      }),
    );
    const files = await collectOpenCodeFiles("Play C:\\game\\flappy.html now");
    expect(files).toEqual([{ name: "flappy.html", mimeType: "text/html", content: "<html>game</html>" }]);
  });

  it("skips oversize files without reading bodies", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const text = vi.fn(async () => "x".repeat(10));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": String(10 * 1024 * 1024) }),
        body: { cancel: async () => undefined },
        text,
      }) as unknown as Response),
    );
    const files = await collectOpenCodeFiles("Big /tmp/dump.json here");
    expect(files).toEqual([]);
    expect(text).not.toHaveBeenCalled();
  });

  it("collects nothing when unconfigured", async () => {
    const spy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", spy);
    await expect(collectOpenCodeFiles("See C:\\a\\b.html")).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("live tool activity + path nudge", () => {
  const sseFrame = (type: string, data: Record<string, unknown>) =>
    `data: ${JSON.stringify({ type, data })}\n\n`;

  it("reports each tool call and nudges absolute paths in the prompt", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    let promptBody = "";
    const sse =
      sseFrame("session.next.tool.called", { sessionID: "ses_ta", tool: "write" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_ta", delta: "Ho" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_other", delta: "NOPE" }) +
      sseFrame("session.next.tool.success", { sessionID: "ses_ta" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_ta", delta: "la" }) +
      sseFrame("session.next.step.ended", { sessionID: "ses_ta" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        if (method === "GET" && path === "/api/event") {
          return new Response(sse, { headers: { "content-type": "text/event-stream" } });
        }
        if (method === "POST" && path === "/api/session") {
          return jsonResponse({ data: { id: "ses_ta" } });
        }
        if (method === "POST" && path === "/api/session/ses_ta/prompt") {
          promptBody = String(init?.body ?? "");
          return jsonResponse({ data: { id: "msg_ta" } });
        }
        if (method === "GET" && path === "/api/session/ses_ta/history") {
          return jsonResponse({
            data: [
              { type: "session.next.step.started", data: { assistantMessageID: "msg_aa" } },
              { type: "session.next.step.ended", data: {} },
            ],
          });
        }
        if (method === "GET" && path === "/api/session/ses_ta/message/msg_aa") {
          return jsonResponse({
            data: {
              content: [{ type: "text", text: "Hola" }],
              finish: "stop",
              tokens: { input: 3, output: 2 },
              time: { completed: 4 },
            },
          });
        }
        throw new Error(`unexpected fetch ${method} ${path}`);
      }),
    );
    const tools: string[] = [];
    const deltas: string[] = [];
    const result = await invokeOpenCode(
      { messages: [{ role: "user", content: "write it" }], model: "opencode:big-pickle" },
      { onToken: (delta) => deltas.push(delta), onToolActivity: (tool) => tools.push(tool) },
    );
    expect(tools).toEqual(["write"]);
    expect(deltas).toEqual(["Ho", "la"]);
    expect(promptBody).toMatch(/absolute path/);
    expect(result.choices[0]?.message.content).toBe("Hola");
  });
});

describe("opencodeStatus", () => {
  it("reports setup guidance when unconfigured", async () => {
    const status = await opencodeStatus();
    expect(status.configured).toBe(false);
    expect(status.operational).toBe(false);
    expect(status.message).toMatch(/OPENCODE_BASE_URL/);
  });

  it("reports operational with server version when healthy", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    mockFetchRoutes([
      { method: "GET", path: "/global/health", respond: () => ({ healthy: true, version: "1.18.31" }) },
    ]);
    const status = await opencodeStatus();
    expect(status).toMatchObject({ provider: "opencode", configured: true, operational: true });
    expect(status.message).toMatch(/1\.18\.31/);
  });
});

describe("opencode fallback routing", () => {
  it("keeps the requested opencode model first", () => {
    expect(fallbackCandidates("opencode:big-pickle")[0]).toBe("opencode:big-pickle");
  });
});

describe("invokeOpenCode live token tail", () => {
  const sseFrame = (type: string, data: Record<string, unknown>) =>
    `data: ${JSON.stringify({ type, data })}\n\n`;

  it("forwards text deltas incrementally and ignores other sessions + reasoning", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const sse =
      sseFrame("server.connected", {}) +
      sseFrame("session.next.text.delta", { sessionID: "ses_live", delta: "Hel" }) +
      sseFrame("session.next.reasoning.delta", { sessionID: "ses_live", delta: "thinking" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_other", delta: "NOPE" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_live", delta: "lo" }) +
      sseFrame("session.next.step.ended", { sessionID: "ses_live" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        if (method === "GET" && path === "/api/event") {
          return new Response(sse, { headers: { "content-type": "text/event-stream" } });
        }
        if (method === "POST" && path === "/api/session") {
          return jsonResponse({ data: { id: "ses_live" } });
        }
        if (method === "POST" && path === "/api/session/ses_live/prompt") {
          return jsonResponse({ data: { id: "msg_live" } });
        }
        if (method === "GET" && path === "/api/session/ses_live/history") {
          return jsonResponse({
            data: [
              { type: "session.next.step.started", data: { assistantMessageID: "msg_a" } },
              { type: "session.next.step.ended", data: {} },
            ],
          });
        }
        if (method === "GET" && path === "/api/session/ses_live/message/msg_a") {
          return jsonResponse({
            data: {
              content: [{ type: "text", text: "Hello" }],
              finish: "stop",
              tokens: { input: 4, output: 2 },
              time: { completed: 7 },
            },
          });
        }
        throw new Error(`unexpected fetch ${method} ${path}`);
      }),
    );
    const deltas: string[] = [];
    const result = await invokeOpenCode(
      { messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" },
      { onToken: (delta) => deltas.push(delta) },
    );
    // Live deltas only — reasoning + foreign-session noise filtered out,
    // final answer NOT re-emitted through onToken (no duplication).
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(result.choices[0]?.message.content).toBe("Hello");
  });

  it("keeps the tail open past intermediate steps so later text still streams", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    const sse =
      sseFrame("session.next.text.delta", { sessionID: "ses_q", delta: "Step" }) +
      sseFrame("session.next.step.ended", { sessionID: "ses_q" }) +
      sseFrame("session.next.text.delta", { sessionID: "ses_q", delta: "Two" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        if (method === "GET" && path === "/api/event") {
          return new Response(sse, { headers: { "content-type": "text/event-stream" } });
        }
        if (method === "POST" && path === "/api/session") {
          return jsonResponse({ data: { id: "ses_q" } });
        }
        if (method === "POST" && path === "/api/session/ses_q/prompt") {
          return jsonResponse({ data: { id: "msg_q" } });
        }
        if (method === "GET" && path === "/api/session/ses_q/history") {
          return jsonResponse({
            data: [
              { type: "session.next.step.started", data: { assistantMessageID: "msg_aq" } },
              { type: "session.next.step.ended", data: {} },
            ],
          });
        }
        if (method === "GET" && path === "/api/session/ses_q/message/msg_aq") {
          return jsonResponse({
            data: {
              content: [{ type: "text", text: "StepTwo" }],
              finish: "stop",
              tokens: { input: 2, output: 2 },
              time: { completed: 5 },
            },
          });
        }
        throw new Error(`unexpected fetch ${method} ${path}`);
      }),
    );
    const deltas: string[] = [];
    const result = await invokeOpenCode(
      { messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" },
      { onToken: (delta) => deltas.push(delta) },
    );
    // The old code exited the tail at the first step.ended and "Two"
    // would have arrived as an end-of-turn blob instead of a live delta.
    expect(deltas).toEqual(["Step", "Two"]);
    expect(result.choices[0]?.message.content).toBe("StepTwo");
  });

  it("still completes via polling when the event stream is dead", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        if (method === "GET" && path === "/api/event") {
          throw new Error("ECONNRESET");
        }
        if (method === "POST" && path === "/api/session") {
          return jsonResponse({ data: { id: "ses_p" } });
        }
        if (method === "POST" && path === "/api/session/ses_p/prompt") {
          return jsonResponse({ data: { id: "msg_p" } });
        }
        if (method === "GET" && path === "/api/session/ses_p/history") {
          return jsonResponse({
            data: [
              { type: "session.next.step.started", data: { assistantMessageID: "msg_ap" } },
              { type: "session.next.step.ended", data: {} },
            ],
          });
        }
        if (method === "GET" && path === "/api/session/ses_p/message/msg_ap") {
          return jsonResponse({
            data: {
              content: [{ type: "text", text: "POLL_OK" }],
              finish: "stop",
              tokens: { input: 1, output: 1 },
              time: { completed: 2 },
            },
          });
        }
        throw new Error(`unexpected fetch ${method} ${path}`);
      }),
    );
    const deltas: string[] = [];
    const result = await invokeOpenCode(
      { messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" },
      { onToken: (delta) => deltas.push(delta) },
    );
    expect(deltas).toEqual([]);
    expect(result.choices[0]?.message.content).toBe("POLL_OK");
  });
});

describe("invokeAiStream opencode branch", () => {
  it("emits the whole answer as one token event", async () => {
    process.env.OPENCODE_BASE_URL = BASE;
    mockFetchRoutes([
      { method: "POST", path: "/api/session", respond: () => ({ data: { id: "ses_9" } }) },
      {
        method: "POST",
        path: "/api/session/ses_9/prompt",
        respond: () => ({ data: { id: "msg_9" } }),
      },
      {
        method: "GET",
        path: "/api/session/ses_9/history",
        respond: () => ({
          data: [
            { type: "session.next.step.started", data: { assistantMessageID: "msg_a9" } },
            { type: "session.next.step.ended", data: {} },
          ],
        }),
      },
      {
        method: "GET",
        path: "/api/session/ses_9/message/msg_a9",
        respond: () => ({
          data: {
            content: [{ type: "text", text: "STREAM_OK" }],
            finish: "stop",
            tokens: { input: 5, output: 2 },
            time: { completed: 9 },
          },
        }),
      },
    ]);
    const { invokeAiStream } = await import("./openai-stream");
    const deltas: string[] = [];
    const round = await invokeAiStream(
      { messages: [{ role: "user", content: "hi" }], model: "opencode:big-pickle" },
      { onToken: (delta) => deltas.push(delta) },
    );
    expect(round.text).toBe("STREAM_OK");
    expect(deltas).toEqual(["STREAM_OK"]);
    expect(round.model).toBe("opencode:big-pickle");
    expect(round.files).toEqual([]);
  });
});
