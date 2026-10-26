# Rook OpenRouter AI Backend

Rook uses **OpenRouter as its primary inference provider**. All model requests originate from the Rook server; the OpenRouter key is never bundled into Expo, returned by tRPC, or stored in a user workroom. Each Bot stores only a public model identifier.

## Runtime architecture

The provider-neutral entry point is `server/ai/index.ts`. OpenRouter-specific catalog discovery, filtering, status checks, error handling, and chat completion requests live in `server/ai/openrouter.ts`. The workroom agent calls this provider boundary while retaining the existing Excel tool loop and approval-gated writes.

The live model catalog comes from OpenRouter’s `GET /api/v1/models` endpoint.[1] Rook exposes only models that meet all of the following conditions:

- prompt price is exactly zero;
- completion price is exactly zero;
- per-request price is absent or exactly zero;
- text output is supported; and
- tool calling is supported.

A Bot defaults to `openrouter/free`, OpenRouter’s automatic free-model router.[2] If a user selects a specific free model, Rook submits that model first and `openrouter/free` second. OpenRouter can therefore fail over when the selected model is unavailable, rate-limited, or rejected.[3] Client-provided IDs are checked against the server’s live zero-cost catalog before use, so changing a network payload cannot make Rook call a paid model.

## Production setup

Create an OpenRouter API key and set it as a **server-only** production environment variable:

```text
OPENROUTER_API_KEY=<secret key>
APP_ORIGIN=https://www.rook.lighting
```

Do not prefix the key with `EXPO_PUBLIC_`. After updating the Vercel environment, redeploy the production project. Account → AI backend should then report **Online**, and each Bot’s profile will offer the current live free-model list.

## Free-tier behavior

OpenRouter currently limits free model variants to **20 requests per minute**. Accounts that have purchased less than $10 in credits receive **50 free-model requests per day**; accounts that have purchased at least $10 in credits receive **1,000 free-model requests per day**.[4] Purchasing credits raises the allowance but does not make zero-priced model requests consume those credits. Rook reads the key tier through `GET /api/v1/key` and displays the applicable daily allowance without exposing credit details or the API key.

When capacity is exhausted, Rook returns a calm retry message and states that no external action was attempted. It performs at most one short retry for transient OpenRouter errors. It does not run a long background retry loop and does not silently move to a paid model.

## User experience

The Account screen shows provider health, the number of currently available free tool-capable models, the applicable daily free-request allowance, and a user price of $0. Each Bot defaults to automatic routing. Users can open a Bot profile and choose a specific live free model; that choice persists in the existing encrypted/authenticated workroom sync payload.

## Future providers

Additional inference providers should be added behind `server/ai/index.ts` and normalized to the existing `InvokeParams`, `InvokeResult`, `AiModel`, and `AiBackendStatus` shapes. The workroom agent and Excel tool loop should not import a provider SDK directly.

[1]: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
[2]: https://openrouter.ai/docs/guides/routing/routers/free-router
[3]: https://openrouter.ai/docs/guides/routing/model-fallbacks
[4]: https://openrouter.ai/docs/api_reference/limits
