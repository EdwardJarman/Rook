import { z } from "zod";

import type { Tool } from "../_core/llm";
import * as db from "../db";
import { buildCommandEnvelope } from "../../shared/node-relay";
import {
  buildCloudCommandEnvelope,
  createCloudSandboxClient,
  normalizeCloudRelPath,
  resolveComputerTarget,
} from "./cloud-computer";

/**
 * Cloud-computer tools for the AI agent. Read tools run immediately against a
 * fresh sandbox; `computer_run_command` and `computer_write_file` are
 * sensitive — they only prepare a durable proposal that the user approves
 * right in the chat, exactly like Excel write tools.
 */

const pathParameter = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      normalizeCloudRelPath(value);
      return true;
    } catch {
      return false;
    }
  }, "Path must be relative and cannot leave the cloud workspace");

const schemas = {
  computer_run_command: z.object({
    command: z.string().min(1).max(2000),
    cwd: z.string().max(500).optional(),
  }),
  computer_read_file: z.object({ path: pathParameter }),
  computer_write_file: z.object({
    path: pathParameter,
    content: z.string().max(200_000),
  }),
  computer_list_files: z.object({ path: pathParameter.optional() }),
} as const;

export type CloudToolName = keyof typeof schemas;
export const CLOUD_TOOL_NAMES = new Set<string>(Object.keys(schemas));

export const CLOUD_SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "computer_run_command",
  "computer_write_file",
]);

export function parseCloudToolArguments(
  name: CloudToolName,
  raw: string,
): z.infer<(typeof schemas)[CloudToolName]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Cloud computer tool arguments must be valid JSON");
  }
  const result = schemas[name].safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid arguments for ${name}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export function cloudTraceTitle(
  name: CloudToolName,
  args?: Record<string, unknown>,
): string {
  const path =
    typeof args?.path === "string" && args.path.trim()
      ? args.path.trim()
      : typeof args?.cwd === "string" && args.cwd.trim()
        ? args.cwd.trim()
        : "";
  const here = path ? ` — ${path.length > 80 ? `${path.slice(0, 80)}…` : path}` : "";
  switch (name) {
    case "computer_run_command": {
      const command =
        typeof args?.command === "string" && args.command.trim()
          ? args.command.trim().split("\n")[0].slice(0, 90)
          : "";
      // A proposal, not an execution — execution waits for chat approval.
      return command
        ? `Proposed command: ${command}`
        : "Proposed a cloud shell command";
    }
    case "computer_read_file":
      return `Read cloud file${here || " from the workspace"}`;
    case "computer_write_file":
      // A proposal, not an execution — execution waits for chat approval.
      return `Proposed writing${here || " a cloud file"}`;
    case "computer_list_files":
      return `Listed cloud files${here || " in the workspace"}`;
  }
}

export function cloudCommandSummary(
  name: CloudToolName,
  args: { command?: string; cwd?: string; path?: string; content?: string },
): string {
  if (name === "computer_run_command") {
    const cwd = args.cwd ? ` in ${args.cwd}` : "";
    return `Run shell command${cwd}: ${args.command ?? ""}`;
  }
  if (name === "computer_write_file") {
    return `Write file ${args.path ?? ""} in the cloud workspace`;
  }
  return "Cloud computer action";
}

export const CLOUD_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "computer_run_command",
      description:
        "Run a shell command on the user's Rook cloud computer (a Linux sandbox). Requires user approval before it runs. Use it to build, test, transform data, or install packages. Keep commands small and self-contained; capture output with the command itself.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
          cwd: { type: "string", description: "Optional working directory inside the cloud workspace" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_read_file",
      description:
        "Read a text file from the user's Rook cloud computer workspace. Paths are relative to the workspace root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path, e.g. reports/notes.md" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_write_file",
      description:
        "Write a text file to the user's Rook cloud computer workspace. Requires user approval before it runs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_list_files",
      description:
        "List files and folders in a directory of the user's Rook cloud computer workspace. Paths are relative to the workspace root; omit the path for the root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional relative directory path" },
        },
      },
    },
  },
];

/**
 * Runs a non-sensitive computer tool immediately. Local-first: if an online
 * paired device exists the command runs there (pageless shell/file action);
 * otherwise it runs in the free cloud sandbox.
 */
export async function executeComputerReadTool(input: {
  userId: string;
  botId: string;
  name: "computer_read_file" | "computer_list_files";
  args: Record<string, unknown>;
}): Promise<unknown> {
  const path = typeof input.args.path === "string" ? input.args.path : "";
  const target = await resolveComputerTarget(input.userId);
  if (target.kind === "none")
    throw new Error(
      "No computer is available: connect Rook Node, or set up the cloud computer.",
    );

  if (target.kind === "local") {
    const action =
      input.name === "computer_read_file"
        ? { type: "readFile" as const, path }
        : { type: "listFiles" as const, path };
    const commandId = makeCommandId();
    const record = await db.enqueueNodeCommand({
      commandId,
      userId: input.userId,
      nodeId: target.nodeId,
      summary: cloudCommandSummary(input.name, input.args),
      capability: "files-read",
      envelope: buildCommandEnvelope({
        userId: input.userId,
        botId: input.botId,
        pageId: `shell:${commandId}`,
        pageRevision: 0,
        capability: "files-read",
        action,
        seq: 1,
        ttlMs: 120_000,
      }),
      requiresApproval: false,
    });
    if (!record) {
      // The node went offline between resolve and enqueue — fall back to cloud.
      return runCloudRead(input.name, path);
    }
    const completed = await waitForLocalCompletion(commandId, 15_000);
    if (!completed)
      throw new Error(
        "Your computer did not respond in time. Try again, or the cloud computer will be used instead.",
      );
    return normalizeLocalReadResult(input.name, completed);
  }

  return runCloudRead(input.name, path);
}

async function runCloudRead(
  name: "computer_read_file" | "computer_list_files",
  path: string,
): Promise<unknown> {
  const client = await createCloudSandboxClient();
  try {
    if (name === "computer_read_file") {
      const content = await client.readFile(path);
      return { path: normalizeCloudRelPath(path), content };
    }
    const entries = await client.listFiles(path);
    return { path: path ? normalizeCloudRelPath(path) : "/", entries };
  } finally {
    await client.kill().catch(() => undefined);
  }
}

/** Maps a local node's pageless result to the shape the chat expects. */
function normalizeLocalReadResult(
  name: "computer_read_file" | "computer_list_files",
  record: { result?: unknown },
): unknown {
  const value = record.result as
    | { result?: { type?: string; path?: string; content?: string; entries?: Array<{ name: string; type: string; size: number }> } }
    | undefined;
  const inner = value?.result;
  if (name === "computer_read_file") {
    return { path: inner?.path ?? "", content: inner?.content ?? "" };
  }
  return {
    path: inner?.path ?? "/",
    entries: (inner?.entries ?? []).map((entry) => ({
      name: entry.name,
      path: `${inner?.path && inner.path !== "/" ? inner.path : ""}/${entry.name}`.replace(/^\/+/, "/"),
      type: entry.type === "dir" ? "dir" : "file",
      size: entry.size,
    })),
  };
}

/** Polls a local command until it completes or the timeout elapses. */
async function waitForLocalCompletion(
  commandId: string,
  timeoutMs: number,
): Promise<{ result?: unknown } | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await db.getNodeCommandById(commandId).catch(() => undefined);
    if (!record) return undefined;
    if (record.state === "completed") return record;
    if (record.state === "declined" || record.state === "expired")
      return { result: undefined };
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  return undefined;
}

/**
 * Prepares a sensitive computer command as a durable, approval-gated proposal.
 * Routes to an online paired device when one exists, else to the cloud sandbox.
 * Execution happens only after the user approves right in the chat.
 */
export async function prepareComputerCommandProposal(input: {
  userId: string;
  botId: string;
  name: "computer_run_command" | "computer_write_file";
  args: { command?: string; cwd?: string; path?: string; content?: string };
}): Promise<{ commandId: string; summary: string; target: "local" | "cloud" }> {
  const commandId = makeCommandId();
  const capability =
    input.name === "computer_run_command" ? "shell" : "files-write";
  const action =
    input.name === "computer_run_command"
      ? {
          type: "runCommand" as const,
          command: input.args.command ?? "",
          ...(input.args.cwd ? { cwd: input.args.cwd } : {}),
        }
      : {
          type: "writeFile" as const,
          path: input.args.path ?? "",
          content: input.args.content ?? "",
        };
  const summary = cloudCommandSummary(input.name, input.args);
  const target = await resolveComputerTarget(input.userId);
  if (target.kind === "none")
    throw new Error(
      "No computer is available: connect Rook Node, or set up the cloud computer.",
    );

  if (target.kind === "local") {
    const record = await db.enqueueNodeCommand({
      commandId,
      userId: input.userId,
      nodeId: target.nodeId,
      summary,
      capability,
      envelope: buildCommandEnvelope({
        userId: input.userId,
        botId: input.botId,
        pageId: `shell:${commandId}`,
        pageRevision: 0,
        capability,
        action,
        seq: 1,
        ttlMs: 120_000,
      }),
      requiresApproval: true,
    });
    if (record) return { commandId: record.commandId, summary, target: "local" };
    // The node vanished — fall through to the cloud sandbox.
  }

  const cloudRecord = await db.enqueueCloudCommand({
    commandId,
    userId: input.userId,
    summary,
    capability,
    envelope: buildCloudCommandEnvelope({
      userId: input.userId,
      botId: input.botId,
      capability,
      action,
      seq: 1,
    }),
    requiresApproval: true,
  });
  if (!cloudRecord)
    throw new Error("Cloud computer storage is unavailable right now");
  return { commandId: cloudRecord.commandId, summary, target: "cloud" };
}

function makeCommandId(): string {
  return `cmd-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
