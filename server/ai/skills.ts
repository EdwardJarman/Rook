/**
 * Rook skill registry: reusable agent procedures in the open Agent Skills
 * shape (`<id>/SKILL.md` with `name`/`description` frontmatter), so any
 * skills.sh skill folder dropped into the library just works.
 *
 * Two speeds, keeping turns fast:
 * - Attached skills (explicit user choice per message) inject their FULL
 *   procedure — worth the tokens because the user asked for it.
 * - Everything else is one description line + the `read_skill` tool, so
 *   the model pulls a full procedure on demand instead of every turn
 *   paying for procedures it will not use.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

import type { Tool } from "../_core/llm";

export type RookSkill = {
  id: string;
  name: string;
  description: string;
  body: string;
};

const SKILL_ID = /^[a-z0-9-]{1,64}$/;
const REGISTRY_TTL_MS = 60_000;
const MAX_BODY_CHARS = 3_000;
const MAX_ATTACHED_SKILLS = 6;
const MAX_CATALOG_LINES = 12;

export const skillsDir = (): string =>
  process.env.ROOK_SKILLS_DIR?.trim() || path.join(process.cwd(), "skills");

/** Parse one SKILL.md file. Null when the shape is wrong — never throws. */
export const parseSkillFile = (
  id: string,
  raw: string,
): Omit<RookSkill, "id"> | null => {
  if (!SKILL_ID.test(id)) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;
  const frontmatter = match[1];
  const body = match[2].trim();
  const field = (key: string): string | undefined => {
    const line = frontmatter
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.toLowerCase().startsWith(`${key}:`));
    return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") || undefined;
  };
  const name = field("name") ?? id;
  const description = field("description");
  if (!description || !body) return null;
  return { name, description, body: body.slice(0, MAX_BODY_CHARS) };
};

let cache: { value: RookSkill[]; expiresAt: number } | undefined;

export async function listSkills(options?: { force?: boolean }): Promise<RookSkill[]> {
  if (!options?.force && cache && cache.expiresAt > Date.now()) return cache.value;
  const dir = skillsDir();
  let entries: string[] = [];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    cache = { value: [], expiresAt: Date.now() + REGISTRY_TTL_MS };
    return [];
  }
  const skills: RookSkill[] = [];
  for (const id of entries) {
    if (!SKILL_ID.test(id)) continue;
    try {
      const raw = await fs.readFile(path.join(dir, id, "SKILL.md"), "utf8");
      const parsed = parseSkillFile(id, raw);
      if (parsed) skills.push({ id, ...parsed });
    } catch {
      // A broken skill folder must never fail a turn; it is simply absent.
    }
  }
  cache = { value: skills, expiresAt: Date.now() + REGISTRY_TTL_MS };
  return skills;
}

export async function getSkill(id: string): Promise<RookSkill | undefined> {
  const normalized = id.trim().toLowerCase();
  if (!SKILL_ID.test(normalized)) return undefined;
  return (await listSkills()).find((skill) => skill.id === normalized);
}

export const __resetSkillsForTests = (): void => {
  cache = undefined;
};

/** One-line catalog for the system prompt: descriptions only, always cheap. */
export async function skillCatalogBlock(): Promise<string> {
  const skills = await listSkills();
  if (!skills.length) return "";
  const shown = skills.slice(0, MAX_CATALOG_LINES);
  const lines = shown.map((skill) => `- ${skill.id}: ${skill.description}`);
  if (skills.length > shown.length) {
    lines.push(`- …and ${skills.length - shown.length} more in the library`);
  }
  return (
    `Rook skills (procedures you can follow; use read_skill for the full text of any one):\n` +
    lines.join("\n")
  );
}

/** Full procedures for explicitly attached skills. Unknown ids are dropped. */
export async function attachedSkillBlock(ids: string[] | undefined): Promise<string> {
  if (!ids?.length) return "";
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const id of ids) {
    if (!SKILL_ID.test(id) || seen.has(id) || blocks.length >= MAX_ATTACHED_SKILLS) continue;
    seen.add(id);
    const skill = await getSkill(id);
    if (skill) blocks.push(`# Skill: ${skill.name}\n${skill.body}`);
  }
  if (!blocks.length) return "";
  return (
    `The user attached these skill procedures to this message. Follow them — they outrank generic habits:\n\n` +
    blocks.join("\n\n---\n\n")
  );
}

const readSkillSchema = z.object({
  skill: z.string().min(1).max(64),
});

export type SkillToolName = "read_skill";
export const SKILL_TOOL_NAMES = new Set<string>(["read_skill"]);

export function parseSkillToolArguments(name: SkillToolName, raw: string): { skill: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Skill tool arguments must be valid JSON");
  }
  const result = readSkillSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid arguments for ${name}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "input"} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export const SKILL_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "read_skill",
      description:
        "Read the full procedure of one Rook skill by its id (see the skills catalog for ids). Use when a skill's one-line description matches the task but you need its full steps before acting. Read-only — always safe.",
      parameters: {
        type: "object",
        properties: {
          skill: {
            type: "string",
            description: "The skill id, e.g. systematic-debugging",
          },
        },
        required: ["skill"],
        additionalProperties: false,
      },
    },
  },
];

export function skillToolTraceTitle(name: SkillToolName): string {
  return name === "read_skill" ? "Read a skill procedure" : name;
}

/** Executes read_skill: returns the full procedure text, or an honest miss. */
export async function executeSkillReadTool(
  name: SkillToolName,
  args: { skill: string },
): Promise<unknown> {
  void name;
  const skill = await getSkill(args.skill.trim().toLowerCase());
  if (!skill) {
    return {
      status: "error",
      message: `No skill named “${args.skill}”. Use an id from the skills catalog. Do not retry with variations.`,
    };
  }
  return {
    status: "completed",
    result: { id: skill.id, name: skill.name, procedure: skill.body },
  };
}
