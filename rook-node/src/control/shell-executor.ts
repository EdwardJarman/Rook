/**
 * Pageless action executor: shell commands and workspace file operations.
 *
 * These actions run on the node itself, not in a browser tab. Shell commands
 * execute with the bot's workspace as the default working directory and are
 * approval-gated upstream (the `shell` capability is sensitive). File actions
 * are confined to the same workspace via the FileBroker's path guards.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { normalizeRelPath, safeResolve } from "../files/broker.js";
import { botWorkspaceDir, type RookConfig } from "../config.js";

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 64_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const MAX_FILE_BYTES = 1_000_000;

export type ShellActionResult =
  | { type: "runResult"; exitCode: number; stdout: string; stderr: string }
  | { type: "fileContent"; path: string; content: string }
  | { type: "fileWritten"; path: string }
  | { type: "fileList"; path: string; entries: Array<{ name: string; type: "file" | "dir"; size: number }> };

function cap(value: string): string {
  if (value.length <= MAX_OUTPUT_BYTES) return value;
  return `${value.slice(0, MAX_OUTPUT_BYTES)}\n… (truncated)`;
}

function resolveInWorkspace(config: RookConfig, botId: string, relPath: string): string {
  const root = botWorkspaceDir(config, botId);
  fs.mkdirSync(root, { recursive: true });
  return safeResolve(root, normalizeRelPath(relPath));
}

/** Runs a pageless action. `botId` scopes file operations to the bot workspace. */
export async function executeShellAction(
  config: RookConfig,
  botId: string,
  action: { type: string; command?: string; cwd?: string; path?: string; content?: string },
): Promise<ShellActionResult> {
  const workspace = botWorkspaceDir(config, botId);
  fs.mkdirSync(workspace, { recursive: true });

  switch (action.type) {
    case "runCommand": {
      const command = String(action.command ?? "").trim();
      if (!command) throw new Error("A shell command is required");
      let cwd = workspace;
      if (typeof action.cwd === "string" && action.cwd.trim()) {
        cwd = safeResolve(workspace, normalizeRelPath(action.cwd));
        fs.mkdirSync(cwd, { recursive: true });
      }
      try {
        const { stdout, stderr } = await execFileAsync(
          process.platform === "win32" ? "cmd.exe" : "/bin/sh",
          process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
          {
            cwd,
            timeout: MAX_COMMAND_TIMEOUT_MS,
            maxBuffer: 4 * MAX_OUTPUT_BYTES,
            env: { ...process.env, ROOK_BOT_WORKSPACE: workspace },
          },
        );
        return { type: "runResult", exitCode: 0, stdout: cap(stdout), stderr: cap(stderr) };
      } catch (error) {
        const err = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
        if (typeof err.code === "number") {
          return {
            type: "runResult",
            exitCode: err.code,
            stdout: cap(err.stdout ?? ""),
            stderr: cap(err.stderr ?? (err.killed ? "Command timed out" : "")),
          };
        }
        throw new Error(err.message ?? "Command failed to start");
      }
    }

    case "readFile": {
      const rel = normalizeRelPath(String(action.path ?? ""));
      const abs = safeResolve(workspace, rel);
      const stat = fs.statSync(abs);
      if (!stat.isFile()) throw new Error("That path is a directory, not a file");
      if (stat.size > MAX_FILE_BYTES)
        throw new Error("That file is too large to read in chat (1 MB limit)");
      const content = fs.readFileSync(abs, "utf8");
      return { type: "fileContent", path: rel, content: cap(content) };
    }

    case "writeFile": {
      const rel = normalizeRelPath(String(action.path ?? ""));
      const abs = safeResolve(workspace, rel);
      const content = String(action.content ?? "");
      if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES)
        throw new Error("That write is too large (1 MB limit)");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      return { type: "fileWritten", path: rel };
    }

    case "listFiles": {
      const rel = action.path ? normalizeRelPath(String(action.path)) : "";
      const abs = rel ? safeResolve(workspace, rel) : workspace;
      const entries = fs.readdirSync(abs, { withFileTypes: true }).map((entry) => {
        let size = 0;
        try {
          size = entry.isDirectory() ? 0 : fs.statSync(path.join(abs, entry.name)).size;
        } catch {
          size = 0;
        }
        return { name: entry.name, type: entry.isDirectory() ? ("dir" as const) : ("file" as const), size };
      });
      return { type: "fileList", path: rel || "/", entries };
    }

    default:
      throw new Error(`Unknown pageless action: ${action.type}`);
  }
}
