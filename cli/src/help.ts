/**
 * Per-command help topics. `rook help <cmd>` and `rook <cmd> --help` render
 * one of these; bare `rook help` keeps the global panel in cli.ts.
 */

export const HELP_TOPICS: Record<string, string[]> = {
  login: [
    "Sign in once; the terminal approves a device code in the browser.",
    "",
    "  rook login [--api-url URL] [--web-url URL] [--token TOKEN]",
    "  echo $TOKEN | rook login   (pipe a token, no browser)",
    "",
    "Tokens live in the OS config dir; ROOK_TOKEN / ROOK_API_URL win (CI).",
  ],
  logout: ["Sign out on this device.", "", "  rook logout"],
  whoami: ["Show who this device is signed in as.", "", "  rook whoami"],
  models: [
    "List the same catalog the web app shows, grouped by provider.",
    "",
    "  rook models [--json] [query]",
    '  rook models pickle          (substring filter)',
    "  rook models --json | jq .",
  ],
  status: [
    "Provider health: online, attention, or setup — same as Account → AI backend.",
    "",
    "  rook status [--json]",
  ],
  doctor: [
    "Self-diagnose: server, auth, models, config, terminal. Rows, not crashes.",
    "",
    "  rook doctor [--json]",
  ],
  ask: [
    "One question, streamed answer. stdout stays clean for pipes.",
    "",
    '  rook ask [-m MODEL] [--no-stream] [--json] "your question"',
    '  rook ask "why is the sky blue" > answer.md',
    '  rook ask -m opencode:big-pickle "write fizzbuzz"',
  ],
  chat: [
    "Interactive REPL: streams, slash commands, model picker, history.",
    "",
    "  rook chat [-m MODEL]",
    "  rook                        (bare, on a terminal, opens chat too)",
    "",
    "Slash: /model /models /new /copy /retry /save /help /exit.",
    "",
    "Keys: tab complete · ctrl+j newline · ctrl+n model picker",
    "      ctrl+c clears the line (twice exits) · ctrl+d exits",
    "      home/end, ctrl+arrows, ctrl+w/u/k edit like readline",
    "      up/down walks history — it persists across sessions",
    "      pasting multiline text just works (bracketed paste)",
  ],
  completion: [
    "Print a shell completion script (commands + flags stay in sync).",
    "",
    "  rook completion bash >> ~/.bashrc",
    "  rook completion zsh > ~/.zsh/completions/_rook",
    "  rook completion powershell | Out-String | Invoke-Expression",
  ],
};

export function topicHelp(topic: string | undefined): string[] | undefined {
  if (!topic) return undefined;
  return HELP_TOPICS[topic.trim().toLowerCase()];
}
