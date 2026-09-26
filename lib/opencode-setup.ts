/**
 * Setup prompt for the user's OWN OpenCode assistant.
 *
 * When Rook's OpenCode backend is not reachable, the fastest fix is often
 * handing this prompt to the agent the user already runs (opencode TUI /
 * web / CLI): it performs the machine-side setup and tells the user the
 * two Rook lines to paste. Pure text builder — unit-tested, no UI deps.
 */

export const OPENCODE_DEFAULT_PORT = 4123;
export const OPENCODE_DEFAULT_HOST = "127.0.0.1";

export const openCodeBaseUrl = (host = OPENCODE_DEFAULT_HOST, port = OPENCODE_DEFAULT_PORT): string =>
  `http://${host}:${port}`;

export function buildOpenCodeSetupPrompt(
  baseUrl = openCodeBaseUrl(),
): string {
  return [
    "Get my OpenCode server running so Rook can use it. Do each step and report back:",
    "",
    "1. Run `opencode --version`. If it is missing, install it: `curl -fsSL https://opencode.ai/install | bash` (Windows: `irm https://opencode.ai/install.ps1 | iex`), then re-check the version.",
    `2. Start the server: \`opencode serve --port ${OPENCODE_DEFAULT_PORT} --hostname ${OPENCODE_DEFAULT_HOST}\`. If you set a password, choose one with OPENCODE_SERVER_PASSWORD and tell me exactly what it is.`,
    `3. Verify it answers: GET ${baseUrl}/global/health must return {"healthy":true}. Retry for up to 30 seconds — the first boot downloads things.`,
    "4. Report back: the base URL, whether you set a password (and what it is), and the opencode version.",
    "",
    "Then tell me — the human, in plain words — to put these lines in Rook's .env.local and restart the Rook server:",
    `OPENCODE_BASE_URL=${baseUrl}`,
    "# OPENCODE_SERVER_PASSWORD=<the password from step 2, or leave unset>",
  ].join("\n");
}
