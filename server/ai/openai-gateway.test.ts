import { describe, expect, it } from "vitest";

import type { InvokeResult } from "../_core/llm";
import {
  filterGatewayModels,
  gatewayRequestError,
  isGatewayEnabled,
  isGatewayModel,
  toChatCompletion,
  toGatewayError,
  toInvokeParams,
  toModelList,
  toSseChunks,
} from "./openai-gateway";

const result = (overrides: Partial<InvokeResult> = {}): InvokeResult => ({
  id: "gen-1",
  created: 1700000000,
  model: "openrouter/free",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "hello" },
      finish_reason: "stop",
    },
  ],
  ...overrides,
});

describe("gateway request mapping", () => {
  it("accepts null assistant content in tool-call histories", () => {
    const call = { id: "c1", type: "function", function: { name: "search", arguments: "{}" } };
    const out = toInvokeParams({ model: "openrouter/free", messages: [
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: "c1", content: "found" },
    ] });
    expect(out.error).toBeUndefined();
    expect(out.params?.messages[0]).toMatchObject({ content: "", tool_calls: [call] });
  });
  it("maps a basic chat body to dispatch params", () => {
    const out = toInvokeParams({
      model: "openrouter/free",
      messages: [
        { role: "system", content: "be nice" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.9,
      top_p: 0.5,
    });
    expect(out.error).toBeUndefined();
    expect(out.params).toMatchObject({
      model: "openrouter/free",
      messages: [
        { role: "system", content: "be nice" },
        { role: "user", content: "hi" },
      ],
    });
  });

  it("maps developer to system and passes tools through", () => {
    const out = toInvokeParams({
      model: "opencode:big-pickle",
      messages: [{ role: "developer", content: "rules" }],
      tools: [{ type: "function", function: { name: "search", parameters: { type: "object" } } }],
      tool_choice: "auto",
      max_tokens: 100,
    });
    expect(out.error).toBeUndefined();
    expect(out.params?.messages[0]?.role).toBe("system");
    expect(out.params?.max_tokens).toBe(100);
    expect(out.params?.tool_choice).toBe("auto");
  });

  it("rejects malformed bodies, bad roles, and chatgpt: models honestly", () => {
    expect(toInvokeParams({}).error?.status).toBe(400);
    expect(toInvokeParams({ model: "x", messages: [] }).error?.status).toBe(400);
    expect(
      toInvokeParams({ model: "x", messages: [{ role: "emperor", content: "hi" }] }).error?.status,
    ).toBe(400);
    const blocked = toInvokeParams({ model: "chatgpt:gpt-5", messages: [{ role: "user", content: "hi" }] });
    expect(blocked.error?.status).toBe(400);
    expect(blocked.error?.message).toContain("ChatGPT");
  });
});

describe("gateway response mapping", () => {
  it("indexes each streamed tool call for client accumulation", () => {
    const calls = ["first", "second"].map((id) => ({ id, type: "function" as const, function: { name: "search", arguments: "{}" } }));
    const chunks = toSseChunks(result({ choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: calls }, finish_reason: "tool_calls" }] }), "m");
    const head = JSON.parse(chunks[0].slice(6));
    expect(head.choices[0].delta.tool_calls).toEqual(calls.map((call, index) => ({ ...call, index })));
  });
  it("builds a chat.completion echoing the requested model", () => {
    const body = toChatCompletion(result(), "custom-name") as {
      object: string;
      model: string;
      choices: Array<{ message: { content: string }; finish_reason: string }>;
    };
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("custom-name");
    expect(body.choices[0]?.message.content).toBe("hello");
    expect(body.choices[0]?.finish_reason).toBe("stop");
  });

  it("passes tool calls through and omits missing usage", () => {
    const body = toChatCompletion(
      result({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "c1", type: "function", function: { name: "search", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: undefined,
      }),
      "m",
    ) as {
      choices: Array<{ message: { tool_calls: unknown[] }; finish_reason: string }>;
      usage?: unknown;
    };
    expect(body.choices[0]?.message.tool_calls).toHaveLength(1);
    expect(body.choices[0]?.finish_reason).toBe("tool_calls");
    expect("usage" in body).toBe(false);
  });

  it("emits SSE deltas plus a terminal chunk", () => {
    const chunks = toSseChunks(result(), "m");
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.startsWith("data: "))).toBe(true);
    const head = JSON.parse(chunks[0]!.slice("data: ".length)) as {
      object: string;
      choices: Array<{ delta: { role: string; content: string }; finish_reason: null }>;
    };
    expect(head.object).toBe("chat.completion.chunk");
    expect(head.choices[0]?.delta).toMatchObject({ role: "assistant", content: "hello" });
    const tail = JSON.parse(chunks[1]!.slice("data: ".length)) as {
      choices: Array<{ finish_reason: string }>;
    };
    expect(tail.choices[0]?.finish_reason).toBe("stop");
  });

  it("maps the model catalog with provider owners", () => {
    const list = toModelList([{ id: "openrouter/free" }, { id: "bare" }]);
    expect(list.object).toBe("list");
    expect(list.data[0]).toMatchObject({ id: "openrouter/free", object: "model", owned_by: "openrouter" });
    expect(list.data[1]).toMatchObject({ owned_by: "rook" });
  });
});

describe("gateway errors and gates", () => {
  it("maps unknown models to 404, rate limits to 429, rest to 500", () => {
    expect(toGatewayError(new Error("That OpenCode model is not available in Rook."))).toMatchObject({
      status: 404,
    });
    expect(toGatewayError(new Error("429 slow"))).toMatchObject({ status: 429 });
    expect(toGatewayError(new Error("kaput")).status).toBe(500);
    expect(gatewayRequestError(400, "bad").body.error.type).toBe("invalid_request_error");
  });

  it("filters chatgpt: models and honors the kill-switch", () => {
    expect(isGatewayModel("chatgpt:gpt-5")).toBe(false);
    expect(isGatewayModel(" ChatGPT:gpt-5 ")).toBe(false);
    expect(isGatewayModel("openrouter/free")).toBe(true);
    expect(filterGatewayModels([{ id: "a" }, { id: "chatgpt:x" }])).toEqual([{ id: "a" }]);
    expect(isGatewayEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isGatewayEnabled({ ROOK_OPENAI_GATEWAY: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
