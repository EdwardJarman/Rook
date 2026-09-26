# Rook Router AI Backends

Rook supports **OrcaRouter** and **TokenRouter** as server-managed AI providers. Both expose OpenAI-compatible chat-completions APIs. Their API keys remain server-only Vercel environment variables and are never bundled into Expo, returned by tRPC, or stored in a workroom snapshot.

## Provider catalogs

Rook exposes this fixed OrcaRouter catalog:

- `deepseek/deepseek-v4-flash-free`
- `qwen/qwen3.8-27b-free`
- `deepseek/deepseek-v4-pro-free`
- `tencent/hy3-free`

Rook exposes this fixed TokenRouter catalog:

- `deepseek/deepseek-v4-pro-0813-free`
- `qwen/qwen3.8-max-free`
- `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`

Client-visible IDs are prefixed with `orcarouter:` or `tokenrouter:`. The server validates that prefix and allowlist, selects the corresponding gateway, strips only that gateway's prefix, and sends the exact upstream model ID in the request body. Unknown prefixed IDs fail closed. OrcaRouter and TokenRouter requests never fall through to OpenRouter auto-routing.

## Runtime architecture

The strict gateway implementation lives in `server/ai/router-gateways.ts` and is dispatched through `server/ai/index.ts`. The workroom agent and Excel tool loop call only the provider-neutral boundary. Both gateways support normalized chat messages, tools, tool choice, structured response formats, reasoning fields, bounded retries, and clear provider-specific errors.

OrcaRouter requests use:

```text
POST https://api.orcarouter.ai/v1/chat/completions
Authorization: Bearer ORCAROUTER_API_KEY
```

TokenRouter requests use:

```text
POST https://api.tokenrouter.com/v1/chat/completions
Authorization: Bearer TOKENROUTER_API_KEY
```

## Production setup

Set these as **Sensitive**, server-only Vercel variables for Production and Preview:

```text
ORCAROUTER_API_KEY=
TOKENROUTER_API_KEY=
```

Never use an `EXPO_PUBLIC_` prefix. After changing either key, redeploy Rook. Account → AI backend shows an independent health card for each provider. The model picker lists only the active provider's models.

## Model identity

A model's answer to “what model are you?” is not reliable evidence by itself because models infer identity from training and system context. Rook now supplies the exact selected, user-visible route in the system message. More importantly, routing tests verify the actual HTTP host and upstream `model` field, which is the authoritative check.
