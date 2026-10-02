/**
 * CLI argument parsing, extracted from cli.ts so it is unit-testable without
 * executing the router (importing cli.ts would run the app). Behavior is
 * byte-identical to the inline version, plus did-you-mean on unknown flags.
 */

import { suggestFrom, UsageError } from "./cli-errors.js";

export type GlobalFlags = {
  apiUrl?: string;
  token?: string;
  model?: string;
  noStream?: boolean;
  json?: boolean;
  outDir?: string;
  webUrl?: string;
};

/** Every top-level command the router accepts. */
export const COMMANDS = [
  "login",
  "logout",
  "whoami",
  "models",
  "status",
  "doctor",
  "ask",
  "chat",
  "help",
  "version",
  "completion",
] as const;

export const KNOWN_FLAGS = [
  "--api-url",
  "--web-url",
  "--token",
  "-m",
  "--model",
  "--no-stream",
  "--json",
  "--out-dir",
  "-h",
  "--help",
  "-V",
  "--version",
] as const;

export const parseArgs = (
  argv: string[],
): { command?: string; positionals: string[]; flags: GlobalFlags } => {
  const positionals: string[] = [];
  const flags: GlobalFlags = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const take = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`Flag ${arg} needs a value.`);
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
    else if (arg === "-h" || arg === "--help") {
      // `rook <cmd> --help` asks about that command; bare `--help` is global.
      const topic = command ? [command, ...positionals] : positionals;
      return { command: "help", positionals: topic, flags };
    }
    else if (arg === "-V" || arg === "--version") return { command: "version", positionals, flags };
    else if (arg.startsWith("-")) {
      const suggestion = suggestFrom(arg, KNOWN_FLAGS);
      throw new UsageError(
        suggestion ? `Unknown flag ${arg}. Did you mean ${suggestion}?` : `Unknown flag ${arg}. Try: rook help`,
      );
    } else if (!command) command = arg;
    else positionals.push(arg);
  }
  return { command, positionals, flags };
};
