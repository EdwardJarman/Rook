import { z } from "zod";

import type { Tool } from "../_core/llm";
import {
  getGithubRepoOverview,
  isValidRepoFullName,
  listGithubRepoFiles,
  readGithubRepoFile,
} from "./github";

const repoParameter = z
  .string()
  .min(3)
  .max(140)
  .refine(isValidRepoFullName, "Repository must look like owner/name");

const schemas = {
  github_repo_overview: z.object({ repo: repoParameter }),
  github_list_files: z.object({
    repo: repoParameter,
    path: z.string().max(500).optional(),
  }),
  github_read_file: z.object({
    repo: repoParameter,
    path: z.string().min(1).max(500),
  }),
} as const;

export type GithubToolName = keyof typeof schemas;
export const GITHUB_TOOL_NAMES = new Set<string>(Object.keys(schemas));

export function parseGithubToolArguments(
  name: GithubToolName,
  raw: string,
): z.infer<(typeof schemas)[GithubToolName]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("GitHub tool arguments must be valid JSON");
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

const repoDoc = (extra: string) =>
  `The repository full name exactly as listed in the GitHub working set (owner/name). ${extra}`;

export const GITHUB_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "github_repo_overview",
      description:
        "Show one repository's overview from the user's GitHub working set: description, default branch, languages, and when it was last pushed.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: repoDoc("Required.") },
        },
        required: ["repo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_list_files",
      description:
        "List the files and subdirectories at one path of a repository in the GitHub working set. Start from the root when unsure.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: repoDoc("Required.") },
          path: {
            type: "string",
            description:
              "Optional directory path inside the repository; defaults to the root.",
          },
        },
        required: ["repo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "github_read_file",
      description:
        "Read one text file from a repository in the GitHub working set. Use github_list_files first to discover exact paths.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: repoDoc("Required.") },
          path: {
            type: "string",
            description:
              "The file path inside the repository, e.g. src/index.ts.",
          },
        },
        required: ["repo", "path"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeGithubReadTool(
  userId: string,
  name: GithubToolName,
  args: z.infer<(typeof schemas)[GithubToolName]>,
) {
  switch (name) {
    case "github_repo_overview":
      return getGithubRepoOverview(userId, (args as { repo: string }).repo);
    case "github_list_files": {
      const listArgs = args as { repo: string; path?: string };
      return listGithubRepoFiles(userId, listArgs.repo, listArgs.path);
    }
    case "github_read_file": {
      const readArgs = args as { repo: string; path: string };
      return readGithubRepoFile(userId, readArgs.repo, readArgs.path);
    }
    default:
      throw new Error(`Unsupported GitHub tool: ${name satisfies never}`);
  }
}

export function githubToolTraceTitle(name: GithubToolName): string {
  switch (name) {
    case "github_repo_overview":
      return "Reviewed a GitHub repository";
    case "github_list_files":
      return "Listed GitHub repository files";
    case "github_read_file":
      return "Read a GitHub repository file";
    default:
      return "Used a GitHub tool";
  }
}
