# Rook OpenAI Gateway (`/api/openai/v1`)

Rook speaks plain OpenAI. Any OpenAI-compatible client — grok custom
models, opencode, Codex-style tools, `curl` — can run on Rook's model
catalog with a `rook_` token. No xAI account, no new credentials: the
same token `rook login` mints.

Base URL (production): `https://www.rook.lighting/api/openai/v1`
Local dev server: `http://localhost:3000/api/openai/v1`

Auth: `Authorization: Bearer rook_…` (Clerk sessions work too).
`chatgpt:` models are listed nowhere here and refused honestly — they
need a connected ChatGPT session, which the gateway cannot provide.

## Endpoints

- `GET /v1/models` → `{object: "list", data: [{id, object: "model", created, owned_by}]}` (chatgpt: filtered).
- `POST /v1/chat/completions` → OpenAI request shape in, `chat.completion`
  out. `stream: true` returns SSE deltas plus `data: [DONE]`.

```bash
export ROOK_TOKEN="rook_…"   # from `rook login`, or $ROOK_TOKEN in CI

curl -s $ROOK_BASE/v1/models -H "Authorization: Bearer $ROOK_TOKEN"

curl -s $ROOK_BASE/v1/chat/completions \
  -H "Authorization: Bearer $ROOK_TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"openrouter/free","messages":[{"role":"user","content":"hi"}]}'

curl -sN $ROOK_BASE/v1/chat/completions \
  -H "Authorization: Bearer $ROOK_TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"openrouter/free","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

## Grok Build as a client

```toml
# ~/.grok/config.toml — Grok Build running on Rook models, no xAI account
[model.rook]
model = "openrouter/free"   # any id from GET /v1/models
base_url = "https://www.rook.lighting/api/openai/v1"
env_key = "ROOK_TOKEN"
```

Then `/model rook` in the TUI or `grok -p "…" -m rook` headless.

## Honest limits (v1)

- Streaming is one-shot: one content delta, one terminal chunk, then
  `[DONE]` — valid SSE, but not token-by-token yet.
- `temperature` / `top_p` are accepted and ignored; sampling belongs to
  provider routing. `max_tokens` and `response_format` are honored.
- `usage` is passed through when providers report it, omitted otherwise —
  never estimated.
- `tool_calls` are returned for the *client* to execute (correct OpenAI
  semantics); the gateway never runs tools.
- `developer` messages arrive as `system`. Unknown roles, bad shapes, and
  unknown models fail with OpenAI-style `{error: {message, type, code}}`
  (unknown models are 404 `model_not_found`).
- Disabled entirely with `ROOK_OPENAI_GATEWAY=0` on the server.
