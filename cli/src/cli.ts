/**
 * rook — Rook in your terminal. Same models as the web app (same backend),
 * installed with one script, zero ceremony afterwards.
 *
 * (The #! shebang is added at bundle time by scripts/build.mjs — keep it
 * out of this source file or the bundle ends up with two.)
 */

import { ApiError } from "./api.js";
import {
  currentProfile,
  defaultApiUrl,
  fetchMe,
  loginWithBrowser,
  loginWithToken,
  logout,
} from "./auth.js";
import { loadProfile } from "./config.js";
import { eprintln, fatal, println } from "./output.js";
import { runAsk } from "./commands/ask.js";
import { runChat } from "./commands/chat.js";
import { listModels, renderModels } from "./commands/models.js";
import { providerStatuses, renderStatus } from "./commands/status.js";

const VERSION = "0.1.0";

const HELP = `rook ${VERSION} — Rook in your terminal. Same models as the web app.

Usage:
  rook login [--api-url URL] [--web-url URL] [--token TOKEN]
  rook logout
  rook whoami
  rook models [--json]
  rook status [--json]
  rook ask [-m MODEL] [--no-stream] <message...>
  rook chat [-m MODEL]
  rook help | rook version

Auth:
  login opens the browser once; approve the device and the terminal
  signs itself in. Tokens live in the OS config dir; ROOK_TOKEN and
  ROOK_API_URL env vars always win (handy for CI).

Examples:
  rook ask "why is the sky blue"
  rook ask -m opencode:big-pickle "write fizzbuzz in python"
  rook chat
  rook models --json | jq .`;

type GlobalFlags = {
  apiUrl?: string;
  token?: string;
  model?: string;
  noStream?: boolean;
  json?: boolean;
  outDir?: string;
  webUrl?: string;
};

const parseArgs = (argv: string[]): { command?: string; positionals: string[]; flags: GlobalFlags } => {
  const positionals: string[] = [];
  const flags: GlobalFlags = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const take = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`Flag ${arg} needs a value.`);
      }
      i += 1;
      return value;
    };
    if (arg === "--api-url") flags.apiUrl = take();
    else if (arg === "--web-url") flags.webUrl = take();
    else if (arg === "--token") flags.token = take();
    else if (arg === "-m" || arg === "--model") flags.model = take();
    else if (arg === "--no-stream") flags.noStream = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--out-dir") flags.outDir = take();
    else if (arg === "-h" || arg === "--help") return { command: "help", positionals, flags };
    else if (arg === "-V" || arg === "--version") return { command: "version", positionals, flags };
    else if (arg.startsWith("-")) throw new Error(`Unknown flag ${arg}. Try: rook help`);
    else if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
};

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  const apiUrl = defaultApiUrl(flags.apiUrl);

  switch (command) {
    case undefined:
    case "help":
      println(HELP);
      return;
    case "version":
      println(VERSION);
      return;
    case "login": {
      if (flags.token) {
        const { me } = await loginWithToken(apiUrl, flags.token);
        println(`Signed in as ${me.name ?? me.id} (${apiUrl}).`);
        return;
      }
      eprintln("Opening the browser to approve this device…");
      const { me } = await loginWithBrowser(apiUrl, {
        webUrl: flags.webUrl,
        onOpened: (manualUrl) =>
          eprintln(
            `If nothing opened, visit:\n  ${manualUrl}\nWaiting for approval in your browser (up to 5 minutes, Ctrl+C to cancel)…`,
          ),
      });
      println(`Signed in as ${me.name ?? me.id} (${apiUrl}).`);
      return;
    }
    case "logout":
      logout();
      println("Signed out on this device.");
      return;
    case "whoami": {
      const me = await fetchMe(loadProfile());
      if (!me) {
        println("Not signed in. Run `rook login`.");
        return;
      }
      println(`${me.name ?? me.id}${me.email ? ` <${me.email}>` : ""}`);
      return;
    }
    case "models":
      println(renderModels(await listModels({ ...currentProfile(), apiUrl }), flags.json === true));
      return;
    case "status":
      println(
        renderStatus(await providerStatuses({ ...currentProfile(), apiUrl }), flags.json === true),
      );
      return;
    case "ask": {
      const message = positionals.join(" ").trim();
      if (!message) fatal('Nothing to ask. Usage: rook ask "your question"');
      await runAsk(
        { ...currentProfile(), apiUrl },
        { message, model: flags.model, stream: flags.noStream !== true, outDir: flags.outDir },
      );
      return;
    }
    case "chat":
      await runChat({ ...currentProfile(), apiUrl }, { model: flags.model, outDir: flags.outDir });
      return;
    default:
      throw new Error(`Unknown command "${command}". Try: rook help`);
  }
}

const run = async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    if (error instanceof ApiError || error instanceof Error) fatal(error.message);
    fatal(String(error));
  }
};

// Piped stdin + `rook login` (no --token): read the token from the pipe first.
if (process.argv[2] === "login" && !process.argv.includes("--token") && process.stdin.isTTY === false) {
  let data = "";
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => {
    if (data.trim()) process.argv.push("--token", data.trim());
    void run();
  });
} else {
  void run();
}
