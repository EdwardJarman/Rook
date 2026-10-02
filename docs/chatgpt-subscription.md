# ChatGPT Subscription Connection

Rook supports an optional **Login with ChatGPT** connection that lets an authenticated Rook user run selected Bots against models included in that user’s ChatGPT plan. The implementation is based on the MIT-licensed [`opencoredev/login-with-chatgpt`](https://github.com/opencoredev/login-with-chatgpt) SDK and OpenAI’s Codex device-code authorization flow.

## User experience

A user opens **Account → AI backend → ChatGPT**, reviews explicit consent text, and chooses **Connect ChatGPT**. Rook requests a short-lived device code and opens OpenAI’s verification page. The user authorizes Rook directly with OpenAI; Rook never receives the user’s password. Once connected, the model selector lists the model slugs currently returned for that specific account and plan.

ChatGPT models use the `chatgpt:` prefix internally. OpenRouter models remain available as Rook’s shared fallback. If a ChatGPT session is missing, expires, or is disconnected — or ChatGPT rejects the chosen model, returns nothing, or has a transient failure — `invokeAiResilient` (the only fallback owner) retries on `openrouter/free` when OpenRouter is configured, and the reply carries an “Answered with a backup model” trace step naming why. Without a configured fallback, the true reason is shown to the user (see below).

## Security model

Each ChatGPT session is bound to the existing authenticated Clerk user. Every `/api/chatgpt/*` request must include a valid Clerk bearer token. Rook derives a deterministic opaque session identifier from the Clerk user ID; the raw ID is not placed in the session key.

The SDK encrypts access and refresh tokens with AES-GCM before storage. Rook stores the encrypted session only in Clerk **private metadata**, which is unavailable to the browser and Clerk Frontend API. The browser receives the device code, public connection state, plan label, and available model slugs; it never receives OpenAI bearer or refresh tokens.

Rook exposes only login, polling, session status, logout, and model discovery to the client. The generic subscription-backed response proxy is not exposed as a public browser route. Bot inference calls it internally after both Rook and ChatGPT session checks. Cross-origin requests are restricted, payloads are capped, and per-user inference is rate-limited.

Disconnecting deletes the encrypted session. Account deletion must also remove Clerk private metadata so no refreshable ChatGPT session remains.

## Important limitations

The connection spends the user’s own ChatGPT plan allowance. Available models and plan limits are controlled by OpenAI and can change without a Rook release. The authorization grant has no narrow per-prompt scope, so informed consent and a visible disconnect action are mandatory.

This path uses ChatGPT-backed **Codex** models and endpoints rather than the separately billed OpenAI Platform API. It should not be described as generic ChatGPT web-session access or as unlimited usage. OpenRouter remains the zero-setup shared provider and operational fallback.

## Runtime dependencies

The integration requires Rook’s existing `CLERK_SECRET_KEY`. Rook derives a domain-separated stable encryption/signing secret from that server-only value, so no additional production credential is required. Rotating the Clerk secret invalidates ChatGPT sessions and requires users to reconnect.

## Verification checklist

Before release, verify that an authenticated user can start device authorization, complete the OpenAI code flow, list models, select a `chatgpt:` model, receive a Bot response, disconnect, and observe the Bot fall back to OpenRouter. Also confirm that an unauthenticated request receives `401`, tokens never appear in response bodies or logs, and a second Clerk user cannot read the first user’s session.

## Failure handling and diagnostics

Every ChatGPT failure becomes a typed `ProviderError` (`server/ai/provider-error.ts`) carrying the layer, HTTP status, provider code and a redacted provider message. Kinds: `model-unavailable` (404/`model_not_found`, “not supported when using Codex with a ChatGPT account”), `auth` (401, `not_authenticated`, `token_refresh_failed`), `rate-limit`, `transient`, `bad-request`, `empty`, `unknown`.

- **Why this matters:** the AI SDK's `streamText().text` rejects with `No output generated` and hides the real failure; it is only delivered to `onError`, which `invokeChatGPT` now captures. Retried failures (429/5xx) arrive wrapped in a `RetryError`, which is unwrapped.
- **Fallback** (ChatGPT → OpenRouter) triggers on `model-unavailable`, `auth`, `empty`, `rate-limit` and `transient`; a plain `bad-request` is surfaced, not swapped. If the fallback also fails, the original error is thrown with the fallback failure attached.
- **Dead models:** when the provider rejects a slug, the model is labelled `unavailable` for that account for 30 minutes (in-memory, per process) — the picker shows it disabled and never auto-selects it; a later success clears it. Set `ROOK_CHATGPT_VERIFY_MODELS=1` to probe every listed slug (one tiny sequential request each, spends a little plan allowance) when the list is built.
- **Logs:** every failure logs `layer`, `provider`, `model`, `kind`, `status`, `code` and the redacted message (`[RookAI] provider failed…`, `[RookAI] streamed turn failed`, `[ChatGPT models] listing failed`). `ROOK_AI_DEBUG=1` additionally logs the slug sent and the raw (redacted, 1 kB) provider body. Search `model failing repeatedly` (console.error, every 3rd consecutive failure of a model) to alert on a dying model; `trpc.ai.turns` also returns `modelHealth` counters.
- **Live drill:** `CLERK_SECRET_KEY=… ROOK_EVAL_SESSION_TOKEN=<Clerk JWT of a ChatGPT-connected user> pnpm drill:chatgpt-models` probes every offered slug, then sends “hey” through the router (set `ROOK_DRILL_MODEL=chatgpt:gpt-5.5` to target a slug, `OPENROUTER_API_KEY` to see the fallback) and prints per-model health.
