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
  loginWithDevice,
  loginWithToken,
  logout,
  resolveServerUrl,
} from "./auth.js";
import type { CliProfile } from "./config.js";
import { eprintln, fatal, println, ROOK_CLI_VERSION } from "./output.js";
import { COMMANDS, parseArgs, type GlobalFlags } from "./args.js";
import { suggestFrom, UsageError, withHint } from "./cli-errors.js";
import { topicHelp } from "./help.js";
import { runAsk } from "./commands/ask.js";
import { runChat } from "./commands/chat.js";
import { renderCompletion } from "./completion.js";
import { renderDoctor, runDoctor } from "./commands/doctor.js";
import { listModels, renderModels } from "./commands/models.js";
import { providerStatuses, renderStatus } from "./commands/status.js";
import { bold, box, c, createSpinner } from "./ui.js";

const VERSION = ROOK_CLI_VERSION;

const HELP = [
  "Same models as the web app, in your terminal.",
  "",
  "  rook login [--api-url URL] [--web-url URL] [--token TOKEN]",
  "  rook logout",
  "  rook whoami",
  "  rook models [--json] [query]",
  "  rook status [--json]",
  "  rook doctor [--json]",
  "  rook ask [-m MODEL] [--no-stream] <message...>",
  "  rook chat [-m MODEL]",
  "  rook completion <bash|zsh|powershell>",
  "  rook help [command] | rook version",
  "",
  "login opens the browser once; approve the device and the terminal",
  "signs itself in. Tokens live in the OS config dir; ROOK_TOKEN and",
  "ROOK_API_URL env vars always win (handy for CI).",
  "",
  '  rook ask "why is the sky blue"',
  '  rook ask -m opencode:big-pickle "write fizzbuzz in python"',
  "  rook chat",
  "  rook models --json | jq .",
  "",
  "Bare `rook` opens the chat.",
];

const printHelp = (): void => {
  println(box({ title: `rook ${VERSION}`, lines: HELP }));
};

async function main(): Promise<void> {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));
  let apiUrl = defaultApiUrl(flags.apiUrl);
  // A stored localhost pin whose dev server died used to strand every
  // command ("unreachable at localhost:3000"). Network commands recover to
  // production — loudly. Explicit --api-url and ROOK_API_URL are taken at
  // face value; offline commands skip the probe entirely.
  const networked = command === undefined || !["help", "version", "logout", "completion"].includes(command);
  if (networked) {
    const resolved = await resolveServerUrl(apiUrl, { explicit: flags.apiUrl !== undefined });
    if (resolved.fellBackFrom) {
      eprintln(
        c(
          "amber",
          `${resolved.fellBackFrom} is unreachable — using ${resolved.apiUrl} instead. ` +
            "Start your dev server, or pass --api-url to override.",
        ),
      );
    }
    apiUrl = resolved.apiUrl;
  }

  switch (command) {
    case undefined:
      // opencode/Claude-style: bare `rook` on a terminal opens the chat.
      // Piped (scripts/CI) keeps the classic help output.
      if (process.stdin.isTTY && process.stdout.isTTY) {
        await runChat({ ...currentProfile(), apiUrl }, { model: flags.model, outDir: flags.outDir });
        return;
      }
      printHelp();
      return;
    case "help": {
      const lines = topicHelp(positionals[0]);
      if (positionals.length && !lines) {
        const suggestion = suggestFrom(positionals[0] ?? "", [...COMMANDS]);
        throw new UsageError(
          suggestion
            ? `No help for "${positionals[0]}". Did you mean "${suggestion}"?`
            : `No help for "${positionals[0]}". Try: rook help`,
        );
      }
      println(box({ title: `rook ${VERSION}`, lines: lines ?? HELP }));
      return;
    }
    case "version":
      println(`${c("mint", bold("◈ rook"))} ${c("dim", `v${VERSION}`)}`);
      return;
    case "login": {
      if (flags.token) {
        const spinner = createSpinner("Verifying token…");
        spinner.start();
        try {
          const { me } = await loginWithToken(apiUrl, flags.token);
          spinner.stop(`${c("mint", "✓")} Signed in as ${bold(me.name ?? me.id)} ${c("dim", `(${apiUrl})`)}`);
        } catch (error) {
          spinner.stop();
          throw error;
        }
        return;
      }
      const { me } = await loginWithDevice(apiUrl, {
        webUrl: flags.webUrl,
        onCode: (code, manualUrl) => {
          println(box({ title: "Device code", lines: [bold(code)] }));
          eprintln(`Approve at:\n  ${manualUrl}\nWaiting for approval (up to 10 minutes, Ctrl+C to cancel)…`);
        },
      });
      println(`${c("mint", "✓")} Signed in as ${bold(me.name ?? me.id)} ${c("dim", `(${apiUrl})`)}`);
      return;
    }
    case "logout":
      logout();
      println(c("dim", "Signed out on this device."));
      return;
    case "whoami": {
      const me = await fetchMe({ ...currentProfile(), apiUrl });
      if (!me) {
        println("Not signed in. Run `rook login`.");
        return;
      }
      println(`${bold(me.name ?? me.id)}${me.email ? ` ${c("dim", `<${me.email}>`)}` : ""} ${c("dim", `· ${apiUrl}`)}`);
      return;
    }
    case "models": {
      const spinner = createSpinner("Loading models…");
      spinner.start();
      try {
        const text = renderModels(
          await listModels({ ...currentProfile(), apiUrl }),
          flags.json === true,
          positionals.join(" ") || undefined,
        );
        spinner.stop();
        println(text);
      } catch (error) {
        spinner.stop();
        throw error;
      }
      return;
    }
    case "status": {
      const spinner = createSpinner("Checking providers…");
      spinner.start();
      try {
        const text = renderStatus(
          await providerStatuses({ ...currentProfile(), apiUrl }),
          flags.json === true,
        );
        spinner.stop();
        println(text);
      } catch (error) {
        spinner.stop();
        throw error;
      }
      return;
    }
    case "doctor": {
      const checks = await runDoctor({ ...currentProfile(), apiUrl });
      println(renderDoctor(checks, flags.json === true));
      return;
    }
    case "completion": {
      const script = renderCompletion(positionals[0]);
      if (!script) {
        throw new UsageError("Usage: rook completion <bash|zsh|powershell>");
      }
      process.stdout.write(script);
      return;
    }
    case "ask": {
      const message = positionals.join(" ").trim();
      if (!message) throw new UsageError('Nothing to ask. Usage: rook ask "your question"');
      await runAsk(
        { ...currentProfile(), apiUrl },
        { message, model: flags.model, stream: flags.noStream !== true, outDir: flags.outDir, json: flags.json === true },
      );
      return;
    }
    case "chat":
      await runChat({ ...currentProfile(), apiUrl }, { model: flags.model, outDir: flags.outDir });
      return;
    default: {
      const suggestion = command ? suggestFrom(command, COMMANDS) : undefined;
      throw new UsageError(
        suggestion
          ? `Unknown command "${command}". Did you mean "${suggestion}"?`
          : `Unknown command "${command}". Try: rook help`,
      );
    }
  }
}

const run = async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    // Usage mistakes exit 2 (scripts can tell them apart); every other
    // failure carries an actionable hint (login, doctor, models).
    if (error instanceof UsageError) fatal(error.message, 2);
    if (error instanceof ApiError || error instanceof Error) fatal(withHint(error.message));
    fatal(withHint(String(error)));
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
