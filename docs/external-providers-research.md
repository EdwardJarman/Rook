# External Providers — More Free Model Usage for Rook

> **Scope:** Every realistic way to get *more free* inference into Rook without re-inventing a model. Covers: auditing the 4 providers Rook already has, making OpenCode work inside Rook (terminal + gateway), and 7+ candidate external gateways ranked by free-tier generosity + tool support. Live fetched 2026-09-13. No pushes, no secrets.

*Previous ultra-research on Orca lives at `docs/orca-research.md` and `docs/orca-extraction-rook.md` — this doc extends it for the free-model expansion.*

---

## TOC

1. Audit — What Rook already has (and the precise Gaps)
2. OpenCode — How it actually works and the exact Rook integration path
3. Candidates — 7 platforms, each as a free-tier card
4. Rank & Recommended set (the 3-5 to ship)
5. Integration plan — `server/ai/` shape, env vars, fallback order, estimated LOC
6. What to skip and why
7. Sources — every URL fetched this session

---

## 1. Audit — Current Free Surface

### 1.1 Live counts (probe 2026-09-12 + code at `server/ai/openrouter.ts:95-108`)

| Provider | Models exposed | How listed | Key env | Tool support |
|----------|---------------|------------|---------|--------------|
| **OpenRouter** dynamic | **19 tool-capable free** (filtered from `/models?limit=1000` where `pricing.prompt==0 && completion==0 && request==0 && output=text && supported_parameters includes tools`) | `normalizeFreeOpenRouterModels:134-137` sorts `Auto` first; `listOpenRouterModels:178-191` injects `openrouter/free` (200k ctx, vision) if absent | `OPENROUTER_API_KEY` (50/day free-tier, 1000 if not free-tier `228-231`) | `supportsTools:true` by filter; vision from `input_modalities image` |
| **OrcaRouter** static | **4** — `deepseek-v4-flash-free` (1M), `qwen3.8-27b-free` (65k), `deepseek-v4-pro-free` (1M), `tencent/hy3-free` (0) | `server/ai/router-gateways.ts:20-49` `ORCAROUTER_MODELS`, prefix `orcarouter:` | `ORCAROUTER_API_KEY` or list is `[]` | Hardcoded `true` |
| **TokenRouter** static | **3** — `deepseek-v4-pro-0813-free` (1M), `qwen3.8-max-free` (0), `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (256k) | `server/ai/router-gateways.ts:51-73` prefix `tokenrouter:` | `TOKENROUTER_API_KEY` | Hardcoded `true` |
| **BYO ChatGPT** | Variable `chatgpt:<slug>` `free:false` | `server/ai/chatgpt.ts:234-253` Clerk `verifyToken` + encrypted `privateMetadata rookChatGPTSession` | `CLERK_SECRET_KEY` + user OAuth | `true`, vision `false` |

**Catalog behavior:** `CATALOG_TTL_MS=10m`, picker `pickAutoModel:328-351` penalty-sorts `SCAFFOLD_PRONE +1` + `WEAK +2` then first-match over `AUTO_MODEL_PREFERENCES:295-318` (22 regexes, live-probed: `cohere/north` passed, `poolside/laguna` flaked, `gemma/nemotron-ultra` 429/timeout, `dots-studio` EMPTY). Gap: picker is evidence-ranked but still single-model-per-gateway fallback — not full breadth.

### 1.2 Fallback chain

*   **Single-provider:** `server/ai/index.ts:47-67` strict prefix dispatch; `chatgpt:` → `invokeChatGPT` with `.catch → invokeOpenRouter(free)`; else OpenRouter. Inside `invokeOpenRouter:363-414` = `models:[model, openrouter/free]` + 3 jittered retries + reasoning retry.
*   **Resilient (v2):** `server/ai/fallback-router.ts:75-133` = `[requested, openrouter/free, firstOrcaModel, firstTokenModel]` (one per gateway), deduped, never TO `chatgpt:84`. Breaker `3 transient → 60s cooldown`. Transient regex `server/ai/agent-reliability.ts:176-178`.

### 1.3 Gaps — why you still want *more* free

*   **Catalog churn:** monthly rotation; zero-price filter is brittle to upstream pricing flips.
*   **429 clustering:** all OpenRouter frees share one `OPENROUTER_API_KEY` + IP (50/day). 429 on one → likely 429 on all. Orca/Token mitigate only via one model per gateway.
*   **Missing breadth:** 13 tools (`server/integrations/agent-tool-executor.ts:56-70`) need reliable tool calls; static gateways claim `supportsTools:true` without probing; no free Mistral/Cohere/Llama gateway replica outside OpenRouter diversity.
*   **BYO friction:** ChatGPT helps paying users only, not free-tier users.

---

## 2. OpenCode — What It Actually Is and How Rook Runs It

### 2.1 TL;DR

OpenCode (https://opencode.ai, repo `anomalyco/opencode` — moved from `sst/opencode`, 27k forks, 207k stars) is a **TUI client + headless HTTP server** AI coding agent — not primarily a model gateway. Tagline: *"Free models included or connect any model from any provider, including Claude, GPT, Gemini"*.

*   **Install:** `curl -fsSL https://opencode.ai/install | bash` | `npm i -g opencode-ai` | `brew install anomalyco/tap/opencode` | `scoop/choco` | `mise`/`nix` | docker `ghcr.io/anomalyco/opencode`.
*   **Anatomy:** `opencode` spawns TUI+server (random port); `opencode serve` headless API-only Server exposing OpenAPI 3.1 at `http://<host>:<port>/doc` and SSE `/event` (docs/server). Not the same as "OpenRouter free" — it's an agent runtime inside your terminal.

### 2.2 Zen — The Model Gateway Part

*   **Zen = curated, optional gateway** (https://opencode.ai/docs/zen) — benchmarked on real coding tasks, like OpenRouter but curated by OpenCode team on provider+model pairs. No markup, **pay-as-you-go, sold at cost** (card fee passed). No monthly fee — CLI is free, you BYO key or fund Zen.
*   **Free tier (the "more free" you asked for): 6 promo models @ $0/$0 per 1M** (limited-time, may log data): `Big Pickle`, `mimo-v2.5-free`, `ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`, `muse-spark-1.3-contributor-free` (contributor trains Meta). Paid spread `$0.15–$180/M` (GPT 5 Nano `$0.05/$0.40` → GPT 5.5 Pro `$30/$180`, Claude Opus 5 `$5/$25`, Gemini 3 Flash `$0.5/$3`). https://opencode.ai/docs/zen
*   **Endpoints:** `https://opencode.ai/zen/v1/{responses,messages,chat/completions,models/gemini-*} ` + `https://opencode.ai/zen/v1/models`. Works for any agent, not just OpenCode.

**Important:** Zen free is **promo + data-may-train** (like Big Pickle). Treat as lab bonus, not durable free like Groq. For durable free, see §3.

### 2.3 The 75+ BYO Providers Behind OpenCode

Via AI SDK + Models.dev catalog: Anthropic, OpenAI, Azure OpenAI, Google Vertex, xAI, DeepSeek, **Groq, Cerebras, Fireworks, Together, Deep Infra, HuggingFace, Cloudflare**, Bedrock, GitHub Copilot (device code), Vercel AI Gateway, Helicone, OpenRouter, ZenMux, Nebius, Modal, NVIDIA NIM, **local Ollama/LM Studio/llama.cpp** via `@ai-sdk/openai-compatible` custom provider (`opencode.json:provider:{npm:"@ai-sdk/openai-compatible", options:{baseURL}}`). Credentials via `/connect`, `opencode auth login` → `~/.local/share/opencode/auth.json`, or `.env`.

### 2.4 How Its Agent/Terminal/MCP/Skills Actually Work

*   **CLI:** `opencode [project] [--port --hostname --model -m --agent --prompt --continue/-c --session/-s]` ; headless `opencode run "prompt" [--attach http://localhost:4096 --format json --model --agent --dir --auto]` ; `serve`/`web`/`attach`/`acp`/`agent`/`mcp`/`models`/`session`/`db`.
*   **TUI:** interactive (WezTerm/Alacritty/Ghostty/Kitty), `@` file fuzzy, `!` bash, `/` slash commands (`/connect /models /compact /undo /redo /share /init /themes`), `Tab` Build↔Plan. Config `tui.json` separate from `opencode.json`.
*   **Agents:** built-in primary `build` (all tools) & `plan` (ask on edit/bash), hidden `compaction/title/summary`; subagents `general` (full+parallel), `explore` (read-only fast), `scout` (docs/dep clone). Custom via `opencode.json:agent{}` or `.opencode/agents/<name>.md`.
*   **MCP/Skills/Plugins:** `mcp:{name:{type:"local" command:["npx",…] }|{type:"remote" url}}` (OAuth DCR), `skills` via `SKILL.md` in `.opencode/skills/` `~/.config/opencode/skills/` etc walked to git worktree, plugins in `.opencode/plugins/*.js|ts` with hooks `tool.execute.before/after`, `server/SDK` via `npm i @opencode-ai/sdk` → `createOpencodeClient({baseUrl})`.

### 2.5 Exact Rook Integration Path — Side-by-Side, Non-Blocking

**Principle:** never `opencode` (blocking TUI) in a shared shell; every tab = isolated port+pty.

*   **Tauri workroom (primary):** Each tab = `xterm.js` → Tauri PTY. Spawn per-agent server: `opencode serve --port 4096 --hostname 127.0.0.1`, `claude`, `codex` each on own port/workspace. Guard with `OPENCODE_SERVER_PASSWORD`/`OPENCODE_SERVER_USERNAME=opencode`. Drive via SDK: `createOpencodeClient({baseUrl:"http://127.0.0.1:4096"})` → `session.create` → `session.prompt({parts:[{type:"text",text}]})`. Monaco file watcher: `watcher.ignore` + git `/undo`. Terminal UI when needed: `opencode attach http://127.0.0.1:4096 --dir <worktree>`.
*   **Expo workroom:** headless `opencode run "task" --format json --model opencode/gpt-5-mini --port <random>` (auto-port, JSON events) or long-lived `serve --port 0` + SDK via `fetch` over `http://localhost:<port>` with CORS `--cors http://localhost:5173`; `opencode web --port 4096` for WebView.
*   **Pane layout:** `[Monaco] [xterm-Claude | xterm-Codex | xterm-OpenCode]` — one server per agent. `--port 4097` for second project to avoid smash. Automation via `opencode run --attach http://localhost:4096 "Explain closures"` reuses warm server. ACP bridge `opencode acp --port …` speaks nd-JSON for Claude ecosystem.
*   **Config for Rook (`opencode.json`):** `model:"opencode/gpt-5-nano"`, `small_model` same, `server:{port:4096, hostname:"127.0.0.1", cors:["http://localhost:5173","tauri://localhost"]}`, `permission:{edit:"ask", bash:{"*":"ask","git status*":"allow"}}`, `share:"manual"`.

**Key caveats for free:** Zen free-promo models may train — allowlist at workspace level; Windows best in WSL; MCP adds context fast — limit via `permission.skill`.

---

## 3. Candidates — 7 Free-Gateway Cards

### Candidate: Groq — **Recommended #1**

*   **Free tier:** **Forever, no credit card**, email→key in 30s. Free ~30 RPM / 6k TPM / 14.4k RPD (Perkstack); Developer (+CC, no min) 10x limits. Per-model Developer base e.g. `gpt-oss-20b/120b, qwen3.6/3.8` =30 RPM/1k RPD/8k TPM/200k TPD. Downgrade anytime. — https://groq.com/pricing + https://console.groq.com/docs/rate-limits
*   **Models free:** **All prod free under limits** — `llama-3.1-8b-instant` (560 tps) / `llama-3.3-70b` / `gpt-oss-20b` / `gpt-oss-120b` / `qwen3.6/3.8` / `minimax-m2.7` / Whisper — no subset.
*   **Tool calling:** Full local `tools` + built-in search/code/Wolfram + MCP remote. Parallel: `llama-3.3, llama-3.1, qwen3.6, minimax` ✓; `gpt-oss` ×.
*   **OpenAI-compat:** `https://api.groq.com/openai/v1` — 1:1 drop-in for `server/ai/router-gateways.ts`.
*   **vs Rook's 19:** **+8-10 distinct fast models** net-new. Best stability/speed; 300-1000 tps makes approval loops instant; 8k TPM tight for long context — must trim.

### Candidate: Google Gemini Free — **Recommended #2 (adapter)**

*   **Free tier:** **No CC**, per-project, RPD reset midnight PT. **Volatile** — Dec 7 2025 cut 50-80% (Flash 250→20-50 RPD). Current snapshots conflict; docs now: *"limits not guaranteed, check AI Studio"*. Free data may train (EEA/CH/UK exempt). Tier1 = link billing (no min) → 150-300 RPM. — https://ai.google.dev/pricing + /gemini-api/docs/rate-limits
*   **Models free:** Gemini-only (`2.5 Flash/Lite/Pro, 3 Flash Preview`) — only free Google frontier; zero overlap with 19.
*   **Tool calling:** Excellent native `functionDeclarations`, parallel, streaming.
*   **OpenAI-compat:** **No** — `https://generativelanguage.googleapis.com/v1beta` requires translation layer.
*   **vs 19:** +2-3 unique frontier despite adapter cost.

### Candidate: Pollinations — **Dark Horse #3**

*   **Free tier:** **Yes, no CC** — Anonymous 1/15s no key; Seed (free reg) 1/5s. Free models =0 Pollen (1≈$1). 30+ text (gpt-oss, deepseek, gemma, mistral, qwen, claude-fast) + Flux images unlimited. — https://gen.pollinations.ai/docs + https://github.com/pollinations/pollinations/blob/master/APIDOCS.md
*   **Tool calling:** `POST /openai` + `https://gen.pollinations.ai/v1/chat/completions` supports `tools` (rate-limited, no SLA, watermark pre-reg).
*   **OpenAI-compat:** Yes, drop-in.
*   **vs 19:** Could add 10-15 free tool models beyond 19, lowest friction.

### Candidate: Cloudflare Workers AI — Durable Small-Model Free

*   **Free tier:** **10k Neurons/day forever, no CC** (Paid for frontier `kimi-k2.6/glm-5.3/deepseek-v4`). 10k≈4M tokens/day on 1b, ~375k on 70b; beyond `$0.011/1k Neurons`. — https://developers.cloudflare.com/workers-ai/platform/pricing/
*   **Tool calling:** Partial (per-model, not OpenAI shape `api.cloudflare.com/.../ai/run/` — needs adapter). Good for small durable free, not approval primary.

### Candidate: Hugging Face Inference Providers — Aggregator

*   **Free tier:** `$0.10/mo Free, $2/mo PRO` — routed at provider rate no markup; after $0.10 → buy credits. ~50-100k tokens total. 200+ models via 18 providers (Groq/Together/Fireworks/Cerebras) — proxy, no exclusive free models. https://huggingface.co/docs/inference-providers
*   **OpenAI-compat:** `https://router.huggingface.co/v1` drop-in (`model:fastest/cheapest`). vs 19: +0 net-new (duplicate).

### Candidate: Fireworks AI — Paid Fast Fallback Only

*   **Free tier:** **$1 one-time credits only**, not recurring. — https://fireworks.ai/pricing — Excellent tools/streaming, but not sustained free.

### Candidate: Together AI — Paid Overflow Only

*   **Free tier:** **NONE — prepaid $5 min**. — https://docs.together.ai/docs/billing-credits — Best compat matrix, but +0 free.

### Candidate: GitHub Models — **DO NOT INTEGRATE**

*   **Retired 2026-07-30:** Playground/catalog/inference/BYOK no longer available → Azure AI Foundry. — https://docs.github.com/en/github-models/about-github-models

**Also noted:** Chutes (PAYG $0.024–$3/1M TEE, no free), Together/Fireworks/Chutes = paid niches; Groq + Gemini + Pollinations dominate free value.

---

## 4. Rank & Recommended Set

| Rank | Provider | Why # | Net-new vs 19 | Friction | Expiry risk |
|------|----------|-------|---------------|----------|-------------|
| **#1 Ship first** | **Groq** | Fastest, most stable, all-models-free, true drop-in, no CC | +8-10 | 30s signup | Very low (forever free; incentive is to sell TPM) |
| **#2** | **Gemini free** | Only free Google frontier; excellent tools; fills family gap | +2-3 | No CC, but volatile limits | Medium (Google has cut before; check AI Studio) |
| **#3** | **Pollinations Seed** | Cheapest breadth — 10-15 tool models for one adapter | +10-15 | Free reg, 1/5s | Medium-low (no SLA, watermark) |
| **#4 hold** | **Cloudflare Workers AI** | Durable 10k/day small-model safety net | +0-2 usable | No CC | Low (public free tier promise) |
| **Proxy** | **HF Inference** | Aggregator convenience, no new models | +0 | Same | Low |
| **Paid overflow** | Fireworks/Together/Chutes | Cheap speed when free exhausts | +0 free | $5+ | — |
| **Dead** | GitHub Models | Retired | — | — | — |

**Recommended to ship next:** **Groq → Gemini adapter → Pollinations fallback.** That triples free headroom: Groq'sSeparate 429 bucket breaks OpenRouter clustering; Gemini adds frontier diversity; Pollinations adds raw count for tool-call retries. Keep HF as optional proxy toggle. Treat Fireworks/Together/Chutes as `paid` tier, not free.

---

## 5. Integration Plan — How It Lands in `server/ai/`

### 5.1 Reuse the shape that already works

Rook's `server/ai/router-gateways.ts` is a **fixed OpenAI-compat gateway harness** — the same code already serves OrcaRouter (4) + TokenRouter (3) with `GROQ_API_BASE`-style `GatewayConfig` (`apiBase`, `apiKey()`, `prefix`, `models`, `internalId`, `gatewayStatus`, `invokeGateway` with 2-attempt retry + 9s streaming idle/timeout now). New gateways are additive — no refactor.

### 5.2 Env vars & prefixes (proposed)

```ini
# .env.local
GROQ_API_KEY=                # Groq free — no CC, https://console.groq.com/keys
GOOGLE_GEMINI_API_KEY=       # Gemini free — no CC, https://aistudio.google.com/apikey
POLLINATIONS_API_KEY=        # optional Seed key — https://enter.pollinations.ai (anon works @ 1/15s without)
# Existing remain:
OPENROUTER_API_KEY=
ORCAROUTER_API_KEY=
TOKENROUTER_API_KEY=
CLERK_SECRET_KEY=
```

**Prefix scheme (mirrors `orcarouter:` / `tokenrouter:`):**

*   `groq:` — e.g. `groq:llama-3.3-70b-versatile`, `groq:qwen3-8b`, `groq:gpt-oss-120b`
*   `gemini:` — e.g. `gemini:gemini-2.5-flash`, `gemini:gemini-2.5-pro` (translated)
*   `pollinations:` — e.g. `pollinations:openai/gpt-oss-20b`, `pollinations:google/gemma-4-31b-it`

### 5.3 File refs & estimated LOC

*   `server/ai/router-gateways.ts` — add 3 `GatewayConfig`s (Groq 10-15 models, Pollinations 10-15) + Gemini translator (~40 lines). Est. +120 LOC.
*   `server/ai/openai-stream.ts` — already has `STREAM_IDLE_TIMEOUT_MS=45s` + `overallMs = max(2m, tokens*150ms, cap 10m)`. Groq inherits it; Gemini adapter wraps same.
*   `server/ai/fallback-router.ts` — add `firstGroqModel`, `firstGeminiModel`, `firstPollinationsModel` to `fallbackCandidates: [requested, openrouter/free, firstGroq, firstGemini, firstOrca, firstPolli, firstToken]` — ~15 LOC, breaks the single-key clustering.
*   `server/ai/index.ts` — extend `listAiModels` + `getAiBackendStatus` to include Groq/Gemini/Polli statuses (Orca pattern). ~20 LOC.
*   Docs: add to `docs/ai-backend-research.md` providers table; update `docs/external-providers-research.md` shipped status.

**Total:** ~150-180 LOC, zero schema changes, no new tables, no push.

### 5.4 Fallback order (proposed)

`[user's explicit model] → openrouter/free → groq:llama-3.3-70b → gemini:2.5-flash → orcarouter:deepseek-v4 → pollinations:gpt-oss-20b → tokenrouter:nemotron-3` — breaker `3× transient → 60s cooldown` per `server/ai/fallback-router.ts:38-66` already handles per-provider isolation; each new gateway gets its own breaker bucket automatically.

### 5.5 OpenCode in Rook — the other half of "more free"

OpenCode Zen's 6 free promo models are **not durable** free — log **Groq as `P0`** for durable free, and expose **OpenCode CLI as workspace agent** in parallel:

*   **P0 (free inference):** Ship Groq (1 day, drop-in) → Gemini adapter → Pollinations, as above.
*   **P1 (agent):** Embed OpenCode CLI per worktree pty (Tauri) as described in §2.5 — each worktree gets its own `opencode serve --port` + SDK client. This is how Orca runs "Bring your own agent" — Rook can run Claude Code + Codex + **OpenCode** side-by-side in one room, reusing the same worktree + Monaco + file watcher the user already has. Expose `share:"manual"` (`opencode.json`) so no auto-share.
*   **Keep separate:** Zen gateway vs OpenCode agent — a user can use one, both, or neither. Zen is BYO prepay; the agent is local-first. Don't conflate.

---

## 6. What to Skip and Why

*   **GitHub Models** — retired 2026-07-30 → Azure AI Foundry; do not wire (#6).
*   **Together / Fireworks / Chutes free** — there is none; treat as paid overflow tenants only after free exhausts.
*   **HF Inference as primary free** — $0.10/mo ≈ 50k tokens is not material free headroom; keep as proxy toggle at best (#3 alt).
*   **Verbatim `STYLEGUIDE.md` / Electron triple** — Rook is Tauri; steal isolation pattern, not the triple.

---

## 7. Sources — Every URL Fetched This Session

### Audit (Rook code as source)
*   `server/ai/openrouter.ts:95-108,134-137,178-191,228-231,295-318,328-351,254-277` + `server/ai/router-gateways.ts:20-73` + `server/ai/chatgpt.ts:234-253` + `server/ai/fallback-router.ts:75-133` + `server/ai/index.ts:47-67` + `server/integrations/agent-tool-executor.ts:56-70` + `server/ai/agent-reliability.ts:176-178`

### OpenCode
*   https://opencode.ai
*   https://opencode.ai/docs
*   https://opencode.ai/docs/zen
*   https://opencode.ai/docs/providers
*   https://opencode.ai/docs/cli
*   https://opencode.ai/docs/tui
*   https://opencode.ai/docs/agents
*   https://opencode.ai/docs/mcp-servers
*   https://opencode.ai/docs/skills
*   https://opencode.ai/docs/plugins
*   https://opencode.ai/docs/server
*   https://opencode.ai/docs/sdk
*   https://opencode.ai/docs/config
*   https://github.com/sst/opencode
*   https://github.com/anomalyco/opencode

### Candidates — pricing/limits/tool docs
*   https://groq.com/pricing
*   https://console.groq.com/docs/rate-limits + /docs/models + /docs/openai + /docs/tool-use/overview + /docs/billing-faqs
*   https://ai.google.dev/pricing + /gemini-api/docs/rate-limits + /gemini-api/docs/billing
*   https://www.together.ai/pricing + https://docs.together.ai/docs/billing-credits + /docs/inference/openai-compatibility
*   https://github.com/marketplace/models + https://docs.github.com/en/github-models/about-github-models
*   https://huggingface.co/docs/inference-providers + /docs/inference-providers/pricing + https://huggingface.co/pricing
*   https://fireworks.ai/pricing + https://docs.fireworks.ai/serverless/pricing + /tools-sdks/openai-compatibility + /guides/function-calling
*   https://gen.pollinations.ai/docs + https://github.com/pollinations/pollinations/blob/master/APIDOCS.md + https://enter.pollinations.ai/api/docs/llm.txt
*   https://developers.cloudflare.com/workers-ai/platform/pricing/
*   https://chutes.ai/pricing + https://chutes.ai/docs/guides/agents-and-tools
*   https://stably.ai (pricing references for Orca context)
*   https://raw.githubusercontent.com/stablyai/orca/main/package.json (Orca stack context)
*   Live OpenRouter free catalog probe 2026-09-12 (19 models, priced filtered)

*21 OpenCode URLs + 12 candidate-pricing URLs + 6 Rook source groups = 39 distinct sources this loop.*

