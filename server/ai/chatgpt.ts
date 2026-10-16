import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import { createClerkClient, verifyToken } from "@clerk/backend";
import type { KeyValueStore } from "@opencoredev/loginwithchatgpt-core";
import type { StoredSession } from "@opencoredev/loginwithchatgpt-server";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { ModelMessage } from "ai";

import type { InvokeParams, InvokeResult, Message, ToolCall } from "../_core/llm";
import { extractClerkBearerToken } from "../clerk-auth";
import type { AiModel } from "./index";
import { modelHealth } from "./model-health";
import {
  aiDebug,
  debugBody,
  describeErrorForLog,
  ProviderError,
  toProviderError,
  type ProviderFailureKind,
} from "./provider-error";
import { observeManagedCall } from "./request-accounting";

const CHATGPT_PREFIX = "chatgpt:";
const SESSION_METADATA_KEY = "rookChatGPTSession";
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
  /** Opaque per-account key (never the raw Clerk id) for per-account model health. */
  scope: string;
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

async function runtimeFor(
  request: ExpressRequest,
  effort: "low" | "medium" | "high" = "medium",
): Promise<ChatGPTRuntime> {
  const clerkUserId = await clerkUserIdForRequest(request);
  const sessionStore = new ClerkPrivateMetadataStore<StoredSession>(clerkUserId, SESSION_METADATA_KEY);
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
    },
    reasoningEffort: effort,
    textVerbosity: "medium",
  });
  return {
    scope: userSessionKey(clerkUserId),
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

const verifyOnListing = () => /^(1|true|on)$/i.test(process.env.ROOK_CHATGPT_VERIFY_MODELS ?? "");
const UNAVAILABLE_NOTE = "ChatGPT rejected this model for your account. Pick another one.";

export type ListChatGPTOptions = {
  /** Probe every listed slug with a tiny real request (spends a little of the user's plan). Defaults to ROOK_CHATGPT_VERIFY_MODELS. */
  verify?: boolean;
  invoke?: ChatGPTInvoke;
  concurrency?: number;
};

export async function listChatGPTModels(
  request: ExpressRequest,
  options: ListChatGPTOptions = {},
): Promise<AiModel[]> {
  try {
    const runtime = await runtimeFor(request);
    const slugs = (await runtime.handler.getModels(runtime.sourceRequest)) ?? [];
    aiDebug("chatgpt models listed", { slugs });
    if (options.verify ?? verifyOnListing()) {
      await probeChatGPTModels(request, slugs, { scope: runtime.scope, invoke: options.invoke, concurrency: options.concurrency });
    }
    return slugs.map((slug) => {
      const state = modelHealth.stateOf(runtime.scope, slug);
      const unavailable = state?.state === "unavailable";
      return {
        id: `${CHATGPT_PREFIX}${slug}`,
        name: slug.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
        provider: "ChatGPT",
        description: unavailable
          ? UNAVAILABLE_NOTE
          : "Uses this user's connected ChatGPT plan instead of Rook's shared OpenRouter allowance.",
        contextLength: 0,
        supportsTools: true,
        supportsVision: false,
        automatic: false,
        free: false,
        usageLabel: unavailable ? "Unavailable on your account" : "Your ChatGPT plan",
        ...(unavailable ? { unavailable: true, unavailableReason: state?.reason ?? UNAVAILABLE_NOTE } : {}),
      };
    });
  } catch (error) {
    const failure = toProviderError(error, { layer: "chatgpt-models", provider: "chatgpt" });
    console.warn("[ChatGPT models] listing failed", describeErrorForLog(failure));
    return [];
  }
}

export async function deleteChatGPTSession(request: ExpressRequest): Promise<void> {
  const clerkUserId = await clerkUserIdForRequest(request);
  await new ClerkPrivateMetadataStore<StoredSession>(clerkUserId, SESSION_METADATA_KEY).delete("");
  // Best-effort cleanup of legacy rate buckets from before the limiter was removed.
  await new ClerkPrivateMetadataStore<StoredSession>(clerkUserId, "rookChatGPTRate").delete("").catch(() => undefined);
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

type ChatGPTInvoke = (params: InvokeParams, request: ExpressRequest) => Promise<InvokeResult>;

export async function invokeChatGPT(
  params: InvokeParams,
  request: ExpressRequest,
): Promise<InvokeResult> {
  return observeManagedCall({ provider: "chatgpt", model: params.model ?? "chatgpt", payload: params,
    scope: "sdk-call" }, () => invokeAccountedChatGPT(params, request));
}

export type ModelProbeResult = {
  slug: string;
  status: "ok" | "unavailable" | "unknown";
  kind?: ProviderFailureKind;
  detail?: string;
};

export type ProbeOptions = {
  scope: string;
  invoke?: ChatGPTInvoke;
  concurrency?: number;
  timeoutMs?: number;
};

const withDeadline = <T,>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
};

/**
 * Sequential by default: each probe refreshes the shared session tokens, and
 * concurrent refreshes of a rotating refresh token can invalidate the session.
 *
 * Asks the provider whether each slug is actually usable with one tiny real
 * request. Only a definitive "model unavailable" answer marks a slug dead;
 * auth, rate-limit and transient failures prove nothing about the model.
 */
export async function probeChatGPTModels(
  request: ExpressRequest,
  slugs: string[],
  options: ProbeOptions,
): Promise<ModelProbeResult[]> {
  const invoke = options.invoke ?? invokeChatGPT;
  const results: ModelProbeResult[] = new Array(slugs.length);
  let next = 0;
  const worker = async () => {
    while (next < slugs.length) {
      const index = next++;
      const slug = slugs[index]!;
      const known = modelHealth.stateOf(options.scope, slug);
      if (known) {
        results[index] = known.state === "ok"
          ? { slug, status: "ok" }
          : { slug, status: "unavailable", kind: "model-unavailable", detail: known.reason };
        continue;
      }
      try {
        await withDeadline(
          invoke({
            model: `${CHATGPT_PREFIX}${slug}`,
            messages: [{ role: "user", content: "Reply with the single word OK." }],
            reasoning: { effort: "low" },
          } as InvokeParams, request),
          options.timeoutMs ?? 20_000,
        );
        modelHealth.mark(options.scope, slug, "ok");
        results[index] = { slug, status: "ok" };
      } catch (error) {
        const failure = toProviderError(error, { layer: "chatgpt-probe", provider: "chatgpt", model: slug });
        if (failure.kind === "model-unavailable") {
          modelHealth.mark(options.scope, slug, "unavailable", failure.info.providerMessage);
          results[index] = { slug, status: "unavailable", kind: failure.kind, detail: failure.info.providerMessage };
        } else {
          results[index] = { slug, status: "unknown", kind: failure.kind, detail: failure.info.providerMessage };
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 1, slugs.length || 1)) }, worker));
  return results;
}

const sessionFailure = (error: unknown, model: string): ProviderError => {
  const failure = toProviderError(error, { layer: "chatgpt-session", provider: "chatgpt", model });
  if (failure.kind === "unknown" && /sign in|session|not configured|authenticat/i.test(failure.info.providerMessage)) {
    return new ProviderError({ ...failure.info, kind: "auth" }, { cause: error });
  }
  return failure;
};

async function invokeAccountedChatGPT(
  params: InvokeParams,
  request: ExpressRequest,
): Promise<InvokeResult> {
  const model = chatGPTModelSlug(params.model || "");
  if (!model) throw new Error("Choose a ChatGPT model after connecting your account.");
  const requestedEffort = (params.reasoning as { effort?: unknown } | undefined)?.effort;
  const effort =
    requestedEffort === "low" || requestedEffort === "high" ? requestedEffort : "medium";
  aiDebug("chatgpt dispatch", { requestedModel: params.model, slug: model, effort, tools: params.tools?.length ?? 0 });
  let runtime: ChatGPTRuntime;
  try {
    runtime = await runtimeFor(request, effort);
  } catch (error) {
    throw sessionFailure(error, model);
  }
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
  // `await result.text` rejects with a generic "No output generated" error;
  // the real provider failure (status + body) is only delivered here.
  let streamError: unknown;
  const result = streamText({
    model: chatgpt(model),
    system: prompt.system,
    messages: prompt.messages,
    tools: Object.keys(tools).length ? tools : undefined,
    toolChoice: params.toolChoice === "none" || params.tool_choice === "none" ? "none" : "auto",
    maxRetries: 1,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  let rawText: string, calls: Awaited<typeof result.toolCalls>, finishReason: Awaited<typeof result.finishReason>, usage: Awaited<typeof result.usage>;
  try {
    [rawText, calls, finishReason, usage] = await Promise.all([
      result.text,
      result.toolCalls,
      result.finishReason,
      result.usage,
    ]);
  } catch (error) {
    const failure = toProviderError(streamError ?? error, { layer: "chatgpt-responses", provider: "chatgpt", model });
    if (failure.kind === "model-unavailable") {
      modelHealth.mark(runtime.scope, model, "unavailable", failure.info.providerMessage);
    }
    aiDebug("chatgpt provider failure", { slug: model, ...describeErrorForLog(failure), rawBody: debugBody(streamError ?? error) });
    throw failure;
  }
  modelHealth.mark(runtime.scope, model, "ok");
  const text = userFacingChatGPTText(rawText);
  if (!text && !calls.length) {
    throw new ProviderError({
      layer: "chatgpt-responses",
      provider: "chatgpt",
      model,
      kind: "empty",
      providerMessage: "ChatGPT returned status metadata without an assistant reply.",
    });
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
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.totalTokens,
      prompt_tokens_details: {
        cached_tokens: usage.inputTokenDetails?.cacheReadTokens,
        cache_write_tokens: usage.inputTokenDetails?.cacheWriteTokens,
      },
      completion_tokens_details: { reasoning_tokens: usage.outputTokenDetails?.reasoningTokens },
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
  rate: "rookChatGPTRate",
};

export const __chatGPTUserSessionKeyForTests = userSessionKey;
export const __chatGPTModelPrefixForTests = CHATGPT_PREFIX;
export const __sealChatGPTMetadataForTests = sealMetadata;
export const __openChatGPTMetadataForTests = openMetadata;
