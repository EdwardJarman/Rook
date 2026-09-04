import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { createClerkClient, verifyToken } from "@clerk/backend";
import type { KeyValueStore } from "@opencoredev/loginwithchatgpt-core";
import type { RateLimitBucket, StoredSession } from "@opencoredev/loginwithchatgpt-server";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { ModelMessage } from "ai";

import type { InvokeParams, InvokeResult, Message, ToolCall } from "../_core/llm";
import { extractClerkBearerToken } from "../clerk-auth";
import type { AiModel } from "./index";

const CHATGPT_PREFIX = "chatgpt:";
const SESSION_METADATA_KEY = "rookChatGPTSession";
const RATE_METADATA_KEY = "rookChatGPTRate";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const ALLOWED_EXTERNAL_ROUTES = new Set(["/login", "/status", "/session", "/logout", "/models"]);

type StoredEntry = { payload: string; expiresAt?: number };
type PrivateMetadata = Record<string, unknown>;
type StatusError = Error & { status?: number; statusCode?: number; code?: string };

type ChatGPTHandlerLike = {
  handler(request: Request): Promise<Response>;
  proxyFetch(request: Request): typeof fetch;
  getModels(request: Request): Promise<string[] | undefined>;
};

type ChatGPTRuntime = {
  handler: ChatGPTHandlerLike;
  sourceRequest: Request;
  signedSession: string;
};

const secretKey = () => process.env.CLERK_SECRET_KEY?.trim() || "";

export const isChatGPTModel = (model: string | undefined) =>
  Boolean(model?.startsWith(CHATGPT_PREFIX));

export const chatGPTModelSlug = (model: string) => model.slice(CHATGPT_PREFIX.length);

const sessionSecret = () => {
  const clerkSecret = secretKey();
  if (!clerkSecret) throw new Error("Rook authentication is not configured.");
  return createHash("sha256").update(`rook:login-with-chatgpt:v1:${clerkSecret}`).digest("hex");
};

const userSessionKey = (clerkUserId: string) =>
  `rook_${createHash("sha256").update(clerkUserId).digest("hex").slice(0, 40)}`;

const sealMetadata = (value: unknown) => {
  const iv = randomBytes(12);
  const key = Buffer.from(sessionSecret(), "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
};

const openMetadata = <T,>(payload: string): T | undefined => {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(sessionSecret(), "hex"), Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    const compressed = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
    return JSON.parse(gunzipSync(compressed).toString("utf8")) as T;
  } catch {
    return undefined;
  }
};

async function clerkUserIdForRequest(request: ExpressRequest): Promise<string> {
  const clerkSecret = secretKey();
  const token = extractClerkBearerToken(request.header("authorization"));
  if (!clerkSecret || !token) throw new Error("Sign in to Rook before connecting ChatGPT.");
  const claims = await verifyToken(token, { secretKey: clerkSecret });
  if (!claims.sub) throw new Error("Your Rook session is invalid. Please sign in again.");
  return claims.sub;
}

class ClerkPrivateMetadataStore<T> implements KeyValueStore<T> {
  constructor(
    private readonly clerkUserId: string,
    private readonly metadataKey: string,
  ) {}

  private async readEntry(): Promise<StoredEntry | undefined> {
    const client = createClerkClient({ secretKey: secretKey() });
    const user = await client.users.getUser(this.clerkUserId);
    const candidate = (user.privateMetadata as PrivateMetadata)[this.metadataKey];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
    const entry = candidate as StoredEntry;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      await this.delete("");
      return undefined;
    }
    return entry;
  }

  async get(_key: string): Promise<T | undefined> {
    const entry = await this.readEntry();
    return entry?.payload ? openMetadata<T>(entry.payload) : undefined;
  }

  async set(_key: string, value: T, options: { ttlMs?: number } = {}): Promise<void> {
    let valueForStorage: unknown = value;
    if (this.metadataKey === SESSION_METADATA_KEY) {
      const stored = value as StoredSession;
      if (stored.tokensCipher) {
        const { decryptJson } = await import("@opencoredev/loginwithchatgpt-server");
        const tokens = await decryptJson(stored.tokensCipher, sessionSecret());
        if (!tokens) throw new Error("Could not secure the ChatGPT session.");
        valueForStorage = { ...stored, tokensCipher: undefined, tokensPlain: tokens };
      }
    }
    const payload = sealMetadata(valueForStorage);
    if (Buffer.byteLength(payload, "utf8") > 7_200) {
      throw new Error("The ChatGPT session is too large for secure account storage.");
    }
    const client = createClerkClient({ secretKey: secretKey() });
    await client.users.updateUserMetadata(this.clerkUserId, {
      privateMetadata: {
        [this.metadataKey]: {
          payload,
          ...(options.ttlMs ? { expiresAt: Date.now() + options.ttlMs } : {}),
        },
      },
    });
  }

  async delete(_key: string): Promise<void> {
    const client = createClerkClient({ secretKey: secretKey() });
    await client.users.updateUserMetadata(this.clerkUserId, {
      privateMetadata: { [this.metadataKey]: null },
    });
  }
}

const requestOrigin = (request: ExpressRequest) => {
  const forwarded = request.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded || request.protocol || "https";
  const host = request.header("host") || "www.rook.lighting";
  return `${protocol}://${host}`;
};

async function createInternalRequest(
  request: ExpressRequest,
  signedSession: string,
  path = "/session",
  method = "GET",
): Promise<Request> {
  const headers = new Headers();
  const origin = request.header("origin") || requestOrigin(request);
  headers.set("origin", origin);
  headers.set("x-forwarded-proto", "https");
  headers.set("cookie", `rook_chatgpt_session=${signedSession}`);
  headers.set("accept", "application/json");
  return new Request(`${requestOrigin(request)}/api/chatgpt${path}`, { method, headers });
}

async function runtimeFor(request: ExpressRequest): Promise<ChatGPTRuntime> {
  const clerkUserId = await clerkUserIdForRequest(request);
  const sessionStore = new ClerkPrivateMetadataStore<StoredSession>(clerkUserId, SESSION_METADATA_KEY);
  const rateStore = new ClerkPrivateMetadataStore<RateLimitBucket>(clerkUserId, RATE_METADATA_KEY);
  const secret = sessionSecret();
  const { createChatGPTHandler, sign } = await import("@opencoredev/loginwithchatgpt-server");
  const signedSession = await sign(userSessionKey(clerkUserId), secret);
  const handler = createChatGPTHandler({
    secret,
    sessionStore,
    cookieName: "rook_chatgpt_session",
    sessionTtlMs: SESSION_TTL_MS,
    allowedOrigins: ["https://rook.lighting", "https://www.rook.lighting"],
    responsesProxy: {
      maxRequestBytes: 2 * 1024 * 1024,
      rateLimit: { limit: 20, windowMs: 60_000, store: rateStore },
    },
    reasoningEffort: "medium",
    textVerbosity: "medium",
  });
  return {
    handler,
    sourceRequest: await createInternalRequest(request, signedSession),
    signedSession,
  };
}

export async function handleChatGPTRoute(request: ExpressRequest, response: ExpressResponse) {
  const route = request.path.replace(/^\/api\/chatgpt/, "") || "/session";
  if (!ALLOWED_EXTERNAL_ROUTES.has(route)) {
    response.status(404).json({ error: "not_found" });
    return;
  }
  try {
    const runtime = await runtimeFor(request);
    const target = await createInternalRequest(
      request,
      runtime.signedSession,
      route,
      request.method,
    );
    const result = await runtime.handler.handler(target);
    response.status(result.status);
    for (const header of ["content-type", "cache-control", "retry-after"]) {
      const value = result.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.send(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "ChatGPT connection failed.";
    const statusError = error as StatusError;
    const rateLimited = statusError.status === 429 || statusError.statusCode === 429 || /too many requests|rate.?limit/i.test(message);
    const status = rateLimited
      ? 429
      : message.includes("Sign in") || message.includes("session")
        ? 401
        : 503;
    if (rateLimited) response.setHeader("retry-after", "15");
    console.warn("[ChatGPT connection] Request failed", {
      route,
      status,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorCode: statusError.code,
    });
    response.status(status).json({
      error: rateLimited ? "chatgpt_rate_limited" : "chatgpt_unavailable",
      message: rateLimited ? "ChatGPT is temporarily rate limited. Please wait a moment while Rook retries." : message,
    });
  }
}

export async function listChatGPTModels(request: ExpressRequest): Promise<AiModel[]> {
  try {
    const runtime = await runtimeFor(request);
    const models = await runtime.handler.getModels(runtime.sourceRequest);
    return (models ?? []).map((slug) => ({
      id: `${CHATGPT_PREFIX}${slug}`,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      provider: "ChatGPT",
      description: "Uses this user's connected ChatGPT plan instead of Rook's shared OpenRouter allowance.",
      contextLength: 0,
      supportsTools: true,
      supportsVision: false,
      automatic: false,
      free: false,
      usageLabel: "Your ChatGPT plan",
    }));
  } catch {
    return [];
  }
}

export async function deleteChatGPTSession(request: ExpressRequest): Promise<void> {
  const clerkUserId = await clerkUserIdForRequest(request);
  await Promise.all([
    new ClerkPrivateMetadataStore<StoredSession>(clerkUserId, SESSION_METADATA_KEY).delete(""),
    new ClerkPrivateMetadataStore<RateLimitBucket>(clerkUserId, RATE_METADATA_KEY).delete(""),
  ]);
}

function parseToolInput(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function textFromMessage(message: Message): string {
  const parts = Array.isArray(message.content) ? message.content : [message.content];
  return parts
    .map((part) => typeof part === "string" ? part : part.type === "text" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

function toModelMessages(messages: Message[]): { system?: string; messages: ModelMessage[] } {
  const system: string[] = [];
  const converted: ModelMessage[] = [];
  const toolNames = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "system") {
      system.push(textFromMessage(message));
      continue;
    }
    if (message.role === "user") {
      converted.push({ role: "user", content: textFromMessage(message) });
      continue;
    }
    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      const text = textFromMessage(message);
      if (text) content.push({ type: "text", text });
      for (const call of message.tool_calls ?? []) {
        toolNames.set(call.id, call.function.name);
        content.push({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.function.name,
          input: parseToolInput(call.function.arguments),
        });
      }
      converted.push({ role: "assistant", content: content as never });
      continue;
    }
    const toolCallId = message.tool_call_id || "unknown";
    converted.push({
      role: "tool",
      content: [{
        type: "tool-result",
        toolCallId,
        toolName: toolNames.get(toolCallId) || message.name || "tool",
        output: { type: "text", value: textFromMessage(message) },
      }],
    });
  }

  return { system: system.filter(Boolean).join("\n\n") || undefined, messages: converted };
}

export async function invokeChatGPT(
  params: InvokeParams,
  request: ExpressRequest,
): Promise<InvokeResult> {
  const model = chatGPTModelSlug(params.model || "");
  if (!model) throw new Error("Choose a ChatGPT model after connecting your account.");
  const runtime = await runtimeFor(request);
  const [{ createChatGPTProxyProvider }, { streamText, jsonSchema, tool }] = await Promise.all([
    import("@opencoredev/loginwithchatgpt-ai"),
    import("ai"),
  ]);
  const chatgpt = createChatGPTProxyProvider({
    basePath: `${requestOrigin(request)}/api/chatgpt`,
    fetch: runtime.handler.proxyFetch(runtime.sourceRequest),
    defaultModel: model,
  });
  const prompt = toModelMessages(params.messages);
  const tools = Object.fromEntries((params.tools ?? []).map((definition) => [
    definition.function.name,
    tool({
      description: definition.function.description,
      inputSchema: jsonSchema(definition.function.parameters ?? { type: "object", properties: {} }),
    }),
  ]));
  // The ChatGPT Codex endpoint emits a richer server-sent-event stream than
  // its one-shot response. Consuming that stream keeps the actual assistant
  // text separate from internal safety records such as `User Safety: safe`.
  const result = streamText({
    model: chatgpt(model),
    system: prompt.system,
    messages: prompt.messages,
    tools: Object.keys(tools).length ? tools : undefined,
    toolChoice: params.toolChoice === "none" || params.tool_choice === "none" ? "none" : "auto",
    maxRetries: 1,
  });
  const [rawText, calls, finishReason, usage] = await Promise.all([
    result.text,
    result.toolCalls,
    result.finishReason,
    result.usage,
  ]);
  const text = userFacingChatGPTText(rawText);
  if (!text && !calls.length) {
    throw new Error("ChatGPT returned status metadata without an assistant reply.");
  }
  const toolCalls: ToolCall[] = calls.map((call) => ({
    id: call.toolCallId,
    type: "function",
    function: { name: call.toolName, arguments: JSON.stringify(call.input ?? {}) },
  }));
  return {
    id: `chatgpt-${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls.length ? "tool_calls" : finishReason,
    }],
    usage: usage ? {
      prompt_tokens: usage.inputTokens ?? 0,
      completion_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
    } : undefined,
  };
}

/** Removes backend safety bookkeeping that is not a conversational reply. */
export function userFacingChatGPTText(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/^(?:user|response)\s+safety:\s*(?:safe|unsafe)\s*$/i.test(line.trim()))
    .join("\n")
    .trim();
}

export const __chatGPTSessionMetadataKeysForTests = {
  session: SESSION_METADATA_KEY,
  rate: RATE_METADATA_KEY,
};

export const __chatGPTUserSessionKeyForTests = userSessionKey;
export const __chatGPTModelPrefixForTests = CHATGPT_PREFIX;
export const __sealChatGPTMetadataForTests = sealMetadata;
export const __openChatGPTMetadataForTests = openMetadata;
