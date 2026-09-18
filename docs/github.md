# GitHub connector

Rook's GitHub connector lets a signed-in user authorize GitHub once (a normal
OAuth app flow — no personal access tokens to paste) and then pick which
repositories their Bots can read while chatting.

## How it works

```
Account → Connect GitHub ──▶ github.com/login/oauth/authorize (repo, read:user, offline_access)
     ◀── redirect ────────── /api/oauth/github/callback (server exchanges the code)
                                        │
                             encrypted tokens in InstantDB (githubConnections)
                                        │
        Account → Add repositories ──▶ githubSelectedRepos (up to 25, verified via the GitHub API)
                                        │
        Chat: GitHub attached ──▶ read-only tools (overview / list files / read file)
```

* **No access tokens from users.** The OAuth app's client secret never leaves
  the server; the user only ever sees GitHub's own consent screen.
* **Refresh rotation.** `offline_access` returns a rotating refresh token; the
  server refreshes access tokens transparently and marks the connection
  `reauthorize` when the grant is rejected.
* **Tokens are encrypted at rest** with the shared `INTEGRATION_ENCRYPTION_KEY`
  (AES-256-GCM, same envelope as the Microsoft Excel connector).
* **Read-only.** The agent tools (`github_repo_overview`, `github_list_files`,
  `github_read_file`) can only read repositories in the user's working set and
  never write, create, or delete anything in GitHub.
* **Repo allowlist.** Tool calls are rejected server-side unless the repo is in
  `githubSelectedRepos` for that account.

## Where the surfaces live

| Surface | What the user sees |
| --- | --- |
| Web + mobile (Expo) | Account → Connected apps → GitHub card (connect, repo picker, disconnect) and the composer's Connectors sheet |
| Desktop (Rook Node window) | Account → Connected apps → GitHub card (same flow; opens the system browser) |

## Deployment setup

1. Create a **GitHub OAuth App** (Settings → Developer settings → OAuth Apps)
   with the callback URL `https://<your-app-origin>/api/oauth/github/callback`
   (production default: `https://www.rook.lighting/api/oauth/github/callback`).
2. Set the environment variables on the server deployment:

   ```
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   INTEGRATION_ENCRYPTION_KEY=...   # already required by the Excel connector
   APP_ORIGIN=https://www.rook.lighting
   # Optional override (defaults to ${APP_ORIGIN}/api/oauth/github/callback):
   # GITHUB_REDIRECT_URI=...
   ```

3. Push the InstantDB schema (adds `githubConnections`, `githubOAuthStates`,
   `githubSelectedRepos`):

   ```bash
   INSTANT_APP_ADMIN_TOKEN=... pnpm db:push
   ```

Native apps return from OAuth via the configured deep link scheme
(`ROOK_MOBILE_SCHEME`, default `manusrook`); the web app returns to
`/account?github=connected`.
