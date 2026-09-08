import type { Sandbox } from "e2b/dist/index.mjs";

import * as db from "../db";
import { cloudNodeId, isCloudNodeId } from "../../shared/node-relay";

export { cloudNodeId, isCloudNodeId };

/**
 * Rook Cloud Computer: a shared, per-account sandbox that gives Bots a
 * filesystem + shell when the owner's own computer is offline (or for work
 * the owner wants to run in parallel). It is the cloud half of the hybrid
 * "agent computer": local Rook Nodes stay the preferred executor; this module
 * is the fallback and the parallel path.
 *
 * v1 keeps the surface small: one sandbox per execution, shell + files only,
 * all actions flowing through the same durable nodeCommands envelope and
 * approval machinery as local commands. Persistence (a long-lived per-account
 * sandbox with snapshots) and browser automation are follow-ups.
 */

export function cloudMissingEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.E2B_API_KEY?.trim()) missing.push("E2B_API_KEY");
  return missing;
}

export function isCloudComputerConfigured(): boolean {
  return cloudMissingEnvVars().length === 0;
}

/**
 * Where a Bot's computer action should run — the hybrid decision:
 * an online paired device is the computer; the free cloud sandbox is the
 * overflow when no device is reachable.
 */
export type ComputerTarget =
  | { kind: "local"; nodeId: string }
  | { kind: "cloud" }
  | { kind: "none" };

export async function resolveComputerTarget(
  userId: string,
): Promise<ComputerTarget> {
  const node = await db.getOnlineRookNode(userId).catch(() => undefined);
  if (node) return { kind: "local", nodeId: node.nodeId };
  if (isCloudComputerConfigured()) return { kind: "cloud" };
  return { kind: "none" };
}

/**
 * Cloud-computer capabilities. `shell` and `files-write` are sensitive
 * (approval-gated exactly like the local node's sensitive capabilities);
 * `files-read` runs immediately.
 */
export const CLOUD_CAPABILITIES = ["shell", "files-read", "files-write"] as const;
export type CloudCapability = (typeof CLOUD_CAPABILITIES)[number];

const CLOUD_SENSITIVE_CAPABILITIES: ReadonlySet<string> = new Set([
  "shell",
  "files-write",
]);

export function isCloudSensitiveCapability(capability: string): boolean {
  return CLOUD_SENSITIVE_CAPABILITIES.has(capability);
}

/**
 * Normalizes a client-supplied cloud path, rejecting anything that escapes the
 * sandbox workspace. Mirrors rook-node's FileBroker.normalizeRelPath so the two
 * executors enforce the same filesystem contract.
 */
export function normalizeCloudRelPath(input: string): string {
  if (!input || input.includes("\0")) throw new Error("Invalid cloud path");
  const trimmed = input.trim();
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("//")
  ) {
    throw new Error("Cloud paths must be relative to the sandbox workspace");
  }
  const parts = trimmed.split(/[\\/]+/).filter(Boolean).filter((part) => part !== ".");
  if (parts.some((part) => part === ".."))
    throw new Error("Cloud paths cannot leave the sandbox workspace");
  return parts.join("/");
}

export const CLOUD_COMMAND_MAX_TIMEOUT_MS = 60_000;
export const CLOUD_COMMAND_MAX_OUTPUT_BYTES = 64_000;

export type CloudRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CloudFileEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size: number;
};

/** The minimal sandbox surface Rook uses. Tests inject a fake. */
export interface CloudSandboxClient {
  runCommand(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<CloudRunResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<CloudFileEntry[]>;
  kill(): Promise<void>;
}

function capOutput(value: string): string {
  if (value.length <= CLOUD_COMMAND_MAX_OUTPUT_BYTES) return value;
  return `${value.slice(0, CLOUD_COMMAND_MAX_OUTPUT_BYTES)}\n… (truncated)`;
}

/** Creates a live E2B-backed sandbox client. Caller owns kill(). */
export async function createCloudSandboxClient(
  apiKey?: string,
): Promise<CloudSandboxClient> {
  const key = apiKey ?? process.env.E2B_API_KEY?.trim();
  if (!key) throw new Error("E2B_API_KEY is not set on this deployment");
  // e2b's package.json has no "exports" field, so a bare import("e2b")
  // resolves to its CJS build (main), which require()s chalk 5 — ESM-only —
  // and crashes under Node < 22 (ERR_REQUIRE_ESM on Vercel; tsx masked it in
  // dev). Load the ESM build directly: Node treats .mjs as ESM regardless of
  // the package's type field. The literal specifier keeps the import
  // statically traceable for esbuild and Vercel's dependency tracer.
  const { Sandbox: E2BSandbox } = await import("e2b/dist/index.mjs");
  const sandbox = (await E2BSandbox.create({
    timeoutMs: CLOUD_COMMAND_MAX_TIMEOUT_MS + 30_000,
  })) as Sandbox;
  return {
    async runCommand(command, opts) {
      const result = await sandbox.commands.run(command, {
        cwd: opts?.cwd,
        timeoutMs: Math.min(
          opts?.timeoutMs ?? 30_000,
          CLOUD_COMMAND_MAX_TIMEOUT_MS,
        ),
      });
      return {
        exitCode: result.exitCode,
        stdout: capOutput(result.stdout),
        stderr: capOutput(result.stderr),
      };
    },
    async readFile(path) {
      const text = await sandbox.files.read(normalizeCloudRelPath(path));
      return capOutput(text);
    },
    async writeFile(path, content) {
      await sandbox.files.write(normalizeCloudRelPath(path), content);
    },
    async listFiles(path) {
      const entries = await sandbox.files.list(normalizeCloudRelPath(path));
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === "dir" ? ("dir" as const) : ("file" as const),
        size: entry.size ?? 0,
      }));
    },
    async kill() {
      await sandbox.kill();
    },
  };
}

/** Builds the envelope stored on a cloud nodeCommand. */
export function buildCloudCommandEnvelope(input: {
  userId: string;
  botId: string;
  capability: CloudCapability;
  action: Record<string, unknown>;
  seq: number;
}): Record<string, unknown> {
  const issuedAt = Date.now();
  return {
    kind: "cloud",
    userId: input.userId,
    botId: input.botId,
    capability: input.capability,
    action: input.action,
    seq: input.seq,
    issuedAt,
    deadline: issuedAt + CLOUD_COMMAND_MAX_TIMEOUT_MS,
  };
}

/**
 * Executes one approved cloud command and records the result. Claims the
 * pending command (pending -> delivered), runs it through a fresh sandbox, then
 * completes it. Safe to call from the approval path or as a poll fallback.
 */
export async function executeCloudCommand(
  commandId: string,
): Promise<{ ok: boolean; result: unknown; message?: string }> {
  const claimed = await db.claimNextCloudCommand(commandId);
  if (!claimed) {
    const record = await db.getNodeCommandById(commandId).catch(() => undefined);
    if (record) {
      return {
        ok: false,
        result: null,
        message:
          record.state === "completed"
            ? "This command already ran."
            : "This command is not ready to run yet.",
      };
    }
    return { ok: false, result: null, message: "Command not found." };
  }

  let client: CloudSandboxClient | undefined;
  try {
    client = await createCloudSandboxClient();
    const action = claimed.envelope.action as Record<string, unknown> | undefined;
    if (!action || typeof action.type !== "string") {
      throw new Error("Cloud command envelope is missing its action");
    }
    const type = action.type;
    let result: unknown;
    if (type === "runCommand") {
      const command = String(action.command ?? "");
      if (!command.trim())
        throw new Error("A shell command is required for runCommand");
      const run = await client.runCommand(command, {
        cwd: typeof action.cwd === "string" ? action.cwd : undefined,
        timeoutMs:
          typeof action.timeoutMs === "number" ? action.timeoutMs : undefined,
      });
      result = {
        exitCode: run.exitCode,
        stdout: run.stdout,
        stderr: run.stderr,
      };
    } else if (type === "readFile") {
      result = { content: await client.readFile(String(action.path ?? "")) };
    } else if (type === "writeFile") {
      await client.writeFile(String(action.path ?? ""), String(action.content ?? ""));
      result = { written: String(action.path ?? "") };
    } else if (type === "listFiles") {
      result = { entries: await client.listFiles(String(action.path ?? "")) };
    } else {
      throw new Error(`Unknown cloud action type: ${String(type)}`);
    }
    await db.completeNodeCommand(commandId, { ok: true, result });
    return { ok: true, result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cloud sandbox execution failed";
    await db.completeNodeCommand(commandId, { ok: false, message });
    return { ok: false, result: null, message };
  } finally {
    if (client) await client.kill().catch(() => undefined);
  }
}
