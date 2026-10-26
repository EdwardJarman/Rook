# Rook CLI — `rook` in your terminal

Same models as the web app, because it talks to the same backend: the
CLI is a thin client over the Rook API (catalog, chat, and status are
the web's own endpoints). Anything the web can answer, `rook` can.

## Install (one command)

Open the Rook **download page** (`/download` — it detects your system)
and copy the installer for your shell. It looks like this, pointed at
whichever Rook server you are looking at:

```sh
# macOS / Linux:
curl -fsSL https://www.rook.lighting/api/download/cli/install.sh | sh

# Windows PowerShell:
irm https://www.rook.lighting/api/download/cli/install.ps1 | iex
```

(Needs git + node >= 20. No sudo, no admin: user folder only.)

From a Rook checkout you can also run the same scripts directly:

```sh
./cli/install.sh            # macOS / Linux
.\cli\install.ps1           # Windows (PowerShell)
```

Refreshing an install (new UI, same sign-in — credentials are kept):

```sh
./cli/reinstall.sh          # macOS / Linux
.\cli\reinstall.ps1         # Windows (PowerShell)
```

Either way this builds the self-contained bundle (dependencies
included) and puts a `rook` executable on your PATH (`~/.local/bin`,
or `%LOCALAPPDATA%\Rook\bin` on Windows). Then:

```sh
rook login
```

The terminal shows a short device code and opens the approval page — a
static, dependency-light HTML document the API itself serves at
`/api/cli-auth`, so it paints instantly instead of waiting for the full
app bundle. Approve there (check the code matches) and the terminal signs
itself in — no localhost listener, so a closed terminal or a slow approver
cannot strand either side. Codes expire after 10 minutes; just re-run
`rook login` for a fresh one. Tokens live in the OS config dir
(`~/.config/rook/config.json`, mode 0600); `ROOK_TOKEN` and
`ROOK_API_URL` env vars always win (handy for CI).

Default API is `https://www.rook.lighting` (production); point anywhere
else with `--api-url` (every command accepts it). For local development
against your own server, use `--api-url http://localhost:3000`.

## Commands

```sh
rook login [--api-url URL] [--web-url URL] [--token TOKEN]
rook logout
rook whoami
rook models [--json]            # same catalog as web, grouped by provider
rook status [--json]            # provider health (Online / Attention / Setup)
rook ask [-m MODEL] [--no-stream] [--out-dir DIR] <message...>
rook chat [-m MODEL]            # REPL: /model /models /new /copy /retry /save /help /exit
rook help | rook version
```

Answers stream to stdout (pipeable: `rook ask … > answer.md`); progress
and saved-file notes go to stderr. Files an agent builds are saved to
the working directory without clobbering (`game (1).html`).

`rook chat` composer keys: `tab` completes slash commands, `ctrl+j`
inserts a newline (multiline prompts; pasting multiline text just
works), `ctrl+n` opens the model picker, `ctrl+c` clears the line
(twice exits), `ctrl+d` exits. Editing follows readline (`home`/`end`,
`ctrl+arrows`, `ctrl+w`/`u`/`k`); up/down walks your prompt history,
which persists across sessions in the OS config dir.

```sh
rook ask "why is the sky blue"
rook ask -m opencode:big-pickle "write fizzbuzz in python"
rook ask --no-stream "summarize this thread" > summary.md
```

## Server setup (one env var)

CLI sign-in needs a token secret on the Rook server:

```sh
ROOK_CLI_TOKEN_SECRET=<long random string>   # no fallback chain beyond app secrets
```

Fallback chain when unset: `INTEGRATION_ENCRYPTION_KEY`, then
`JWT_SECRET`; minting refuses when all are empty (see it in the boot
`[env]` line). Tokens are stateless HMAC (`rook_…`, 1-year expiry):
rotating the secret invalidates all of them. Per-token server
revocation is not in v1 — `logout` clears the device copy.

## Configuration precedence

The API URL resolves in a fixed order (pinned by `cli/src/auth.test.ts`):

1. `--api-url` flag (explicit — always wins)
2. `ROOK_API_URL` env var
3. Stored profile (`config.json`)
4. Built-in default (`https://www.rook.lighting`)

A stored `localhost` pin whose dev server is gone falls back to production
— loudly — unless the URL came from the flag or the env var, which are
taken at face value and never probed.

## Troubleshooting

- `Not signed in` → `rook login`.
- `Sign-in expired` → `rook login` again.
- `unreachable at …` → the API server is down or `--api-url` is wrong.
- `This Rook server is too old for device login` → restart the server
  from current sources, then try again.
- Code expired → re-run `rook login` for a fresh one.
- Legacy CLIs (localhost-callback flow) still pair through the same
  page's legacy branch, which shows the token with a
  `rook login --token` hint when the terminal is gone.
