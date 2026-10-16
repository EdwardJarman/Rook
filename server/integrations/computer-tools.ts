import { z } from "zod";

import type { Tool } from "../_core/llm";
import { getComputerPromptState } from "../ai/computer-context";
import * as db from "../db";

const MAX_PROPOSALS_PER_TURN = 2;

const schemas = {
  computer_status: z.object({}),
  computer_propose_task: z.object({
    title: z.string().min(4).max(120),
    url: z
      .string()
      .max(2048)
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          (() => {
            try {
              const parsed = new URL(value);
              return parsed.protocol === "https:" || parsed.protocol === "http:";
            } catch {
              return false;
            }
          })(),
        "URL must be a valid http(s) address",
      ),
    detail: z.string().min(1).max(1000).optional(),
  }),
} as const;

export type ComputerToolName = keyof typeof schemas;
export const COMPUTER_TOOL_NAMES = new Set<string>(Object.keys(schemas));

export type ComputerProposal = {
  proposalId: string;
  title: string;
  url?: string;
  detail?: string;
};

export function parseComputerToolArguments(
  name: ComputerToolName,
  raw: string,
): z.infer<(typeof schemas)[ComputerToolName]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Computer tool arguments must be valid JSON");
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

export const COMPUTER_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "computer_status",
      description:
        "Use when the user asks what the computer can do right now. Returns the paired/online state plus node names. Read-only — always safe, never guesses.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "computer_propose_task",
      description:
        "Use when the user asks for browser/computer work (open a page, fill a form, upload/download). Records an approval-gated proposal the user reviews in Updates and runs from the Computer panel — it never executes anything itself.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short human-readable title, e.g. 'Open the invoice portal and download June statement'.",
          },
          url: {
            type: "string",
            description: "Optional starting page (http/https only).",
          },
          detail: {
            type: "string",
            description: "Optional one-paragraph plan: what to open, what to do, what needs the user's approval.",
          },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  },
];

export function computerToolTraceTitle(name: ComputerToolName): string {
  switch (name) {
    case "computer_status":
      return "Checked the shared computer";
    case "computer_propose_task":
      return "Proposed a computer task for approval";
    default:
      return "Used a computer tool";
  }
}

export function computerProposalId(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `cprop-${[...bytes].map((part) => part.toString(16).padStart(8, "0")).join("")}`;
}

/**
 * Executes the read-only computer tools. Proposals are validated and shaped
 * here but recorded by the caller (which owns the per-turn cap + approvals),
 * mirroring how Excel writes flow through `approvals`.
 */
export async function executeComputerReadTool(
  userId: string,
  name: ComputerToolName,
  args: z.infer<(typeof schemas)[ComputerToolName]>,
): Promise<unknown> {
  if (name === "computer_propose_task") {
    throw new Error("computer_propose_task is a proposal tool, not a read tool");
  }
  const [state, nodes] = await Promise.all([
    getComputerPromptState(userId),
    db.listRookNodesForUser(userId).catch(() => []),
  ]);
  void args;
  return {
    paired: state.paired,
    online: state.online,
    nodes: nodes
      .filter((node) => node.status !== "revoked")
      .slice(0, 5)
      .map((node) => ({
        name: node.name || "Computer",
        status: node.status,
      })),
  };
}

export const MAX_COMPUTER_PROPOSALS_PER_TURN = MAX_PROPOSALS_PER_TURN;
