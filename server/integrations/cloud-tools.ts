import { z } from "zod";

import type { Tool } from "../_core/llm";
import * as db from "../db";
import {
  buildCloudCommandEnvelope,
  createCloudSandboxClient,
  normalizeCloudRelPath,
} from "./cloud-computer";

/**
 * Cloud-computer tools for the AI agent. Read tools run immediately against a
 * fresh sandbox; `computer_run_command` and `computer_write_file` are
 * sensitive — they only prepare a durable proposal that the user approves in
 * Updates, exactly like Excel write tools.
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

export function cloudTraceTitle(name: CloudToolName): string {
  switch (name) {
    case "computer_run_command":
      return "Prepared a cloud shell command";
    case "computer_read_file":
      return "Read a cloud workspace file";
    case "computer_write_file":
      return "Prepared a cloud file write";
    case "computer_list_files":
      return "Listed cloud workspace files";
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

/** Runs a non-sensitive cloud tool immediately against a fresh sandbox. */
export async function executeCloudReadTool(
  name: "computer_read_file" | "computer_list_files",
  args: Record<string, unknown>,
): Promise<unknown> {
  const path = typeof args.path === "string" ? args.path : "";
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

/**
 * Prepares a sensitive cloud command as a durable, approval-gated proposal.
 * Returns the command id; execution happens only after the user approves.
 */
export async function prepareCloudCommandProposal(input: {
  userId: string;
  botId: string;
  name: "computer_run_command" | "computer_write_file";
  args: { command?: string; cwd?: string; path?: string; content?: string };
}): Promise<{ commandId: string; summary: string }> {
  const commandId = `cmd-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const capability = input.name === "computer_run_command" ? "shell" : "files-write";
  const action =
    input.name === "computer_run_command"
      ? {
          type: "runCommand",
          command: input.args.command ?? "",
          ...(input.args.cwd ? { cwd: input.args.cwd } : {}),
        }
      : {
          type: "writeFile",
          path: input.args.path ?? "",
          content: input.args.content ?? "",
        };
  const summary = cloudCommandSummary(input.name, input.args);
  const record = await db.enqueueCloudCommand({
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
  if (!record) throw new Error("Cloud computer storage is unavailable right now");
  return { commandId: record.commandId, summary };
}
