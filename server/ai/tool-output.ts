import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Tool } from "../_core/llm";
import { runPostToolUse } from "./hooks";

export const OUTPUT_INLINE_CHARS = 12_000;
export const OUTPUT_READ_CHARS = 6_000;
const OUTPUT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_STORE_BYTES = 64 * 1024 * 1024;
const REF = /^rook-output:([a-f0-9]{32})$/;
type Scope = { userId: string; botId: string };
/** What produced a retained output; re-authorized against live connector state on every read. */
export type OutputSource = { tool: string; resource?: string };
export type OutputAuthorizer = (source: OutputSource) => boolean | Promise<boolean>;
type StoredOutput = { version: 2; scope: string; source: OutputSource; expiresAt: number; text: string };
const scopeKey = (scope: Scope) => createHash("sha256").update(JSON.stringify([scope.userId, scope.botId])).digest("hex");

export class ToolOutputError extends Error {
  constructor(public readonly code: "OUTPUT_UNAVAILABLE" | "OUTPUT_STORAGE_UNAVAILABLE", message: string) { super(message); this.name = "ToolOutputError"; }
}

/** Redact credentials before either disk retention or model feedback; preserve ordinary prose/code. */
export function redactOutputText(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b(?:sk[-_]|rook_)[a-z0-9_-]{12,}\b/gi, "[redacted credential]")
    .replace(/\b((?:password|passwd|passcode|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|secret|token)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1"[redacted]"');
}
export function serializeToolOutput(value: unknown): string {
  const secretKey = /^(?:authorization|password|passwd|passcode|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|secret|token|cvv|ssn)$/i;
  return JSON.stringify(value, (key, entry) => secretKey.test(key) ? "[redacted]" : typeof entry === "string" ? redactOutputText(entry) : entry) ?? "null";
}

/** Local retention survives process restarts on the same volume; references are never filesystem paths. */
export class ToolOutputStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { root: string; now: () => number; id: () => string }) {}
  async put(scope: Scope, text: string, source: OutputSource): Promise<{ reference: string; characters: number; bytes: number; expiresAt: number }> {
    const write = this.pending.then(async () => {
      const expiresAt = this.options.now() + OUTPUT_TTL_MS;
      const content = JSON.stringify({ version: 2, scope: scopeKey(scope), source, expiresAt, text } satisfies StoredOutput);
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("Output exceeds retention capacity");
      await fs.mkdir(this.options.root, { recursive: true, mode: 0o700 });
      let bytes = 0;
      // Only files created by this store are eligible for expiration. No recursive deletion.
      for (const name of await fs.readdir(this.options.root)) {
        if (!/^[a-f0-9]{32}\.json$/.test(name)) continue;
        const filename = path.join(this.options.root, name);
        const stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (stat.mtimeMs + OUTPUT_TTL_MS < this.options.now()) await fs.unlink(filename);
        else bytes += stat.size;
      }
      if (bytes + Buffer.byteLength(content) > MAX_STORE_BYTES) throw new Error("Output store is full");
      const id = this.options.id();
      if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid output identity");
      const filename = path.join(this.options.root, `${id}.json`);
      await fs.writeFile(filename, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.utimes(filename, new Date(this.options.now()), new Date(this.options.now()));
      return { reference: `rook-output:${id}`, characters: text.length, bytes: Buffer.byteLength(text), expiresAt };
    });
    this.pending = write.catch(() => {});
    try { return await write; }
    catch { throw new ToolOutputError("OUTPUT_STORAGE_UNAVAILABLE", "The tool finished, but its large result could not be retained. No shortened copy is being presented as complete. Request a smaller range or file."); }
  }
  async read(scope: Scope, args: { reference: string; offset?: number; limit?: number; search?: string }, authorize?: OutputAuthorizer) {
    const unavailable = () => new ToolOutputError("OUTPUT_UNAVAILABLE", "That retained output is unavailable, expired, or outside this Bot's scope, or its source is no longer authorized.");
    const match = REF.exec(args.reference);
    if (!match) throw unavailable();
    const offset = args.offset ?? 0, limit = args.limit ?? 2000;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > OUTPUT_READ_CHARS) throw unavailable();
    try {
      const filename = path.join(this.options.root, `${match[1]}.json`);
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw unavailable();
      const stored = JSON.parse(await fs.readFile(filename, "utf8")) as StoredOutput;
      if (stored.version !== 2 || stored.scope !== scopeKey(scope) || typeof stored.source?.tool !== "string" || !Number.isFinite(stored.expiresAt) || stored.expiresAt <= this.options.now() || typeof stored.text !== "string") throw unavailable();
      // Fail closed: a revoked connector, deselected repo, or newly denied tool makes old output unreadable.
      if (authorize && !(await authorize(stored.source))) throw unavailable();
      let start = Math.min(offset, stored.text.length);
      if (args.search) {
        const found = stored.text.indexOf(args.search, start);
        if (found < 0) return { reference: args.reference, found: false, characters: stored.text.length, nextOffset: null, text: "" };
        start = found;
      }
      const end = Math.min(start + limit, stored.text.length);
      return { reference: args.reference, offset: start, characters: stored.text.length, nextOffset: end < stored.text.length ? end : null, text: stored.text.slice(start, end) };
    } catch { throw unavailable(); }
  }
}
export const toolOutputStore = new ToolOutputStore({ root: process.env.ROOK_TOOL_OUTPUT_DIR || path.join(os.tmpdir(), "rook-tool-output-v1"), now: Date.now, id: () => randomBytes(16).toString("hex") });

export const readToolOutputArgs = z.object({ reference: z.string().regex(REF), offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(OUTPUT_READ_CHARS).optional(), search: z.string().min(1).max(200).optional() }).strict();
export const OUTPUT_TOOLS: Tool[] = [{ type: "function", function: { name: "read_tool_output",
  description: "Read a retained large tool result for this Bot. Use its rook-output reference, a character offset, or an exact search string. Returns text, total characters, and the next offset; expired or unavailable references return an error.",
  parameters: { type: "object", properties: { reference: { type: "string", description: "The rook-output reference returned by a tool result." },
    offset: { type: "integer", minimum: 0, description: "Character offset, starting at zero." }, limit: { type: "integer", minimum: 1, maximum: OUTPUT_READ_CHARS },
    search: { type: "string", description: "Optional exact text to find at or after the offset." } }, required: ["reference"], additionalProperties: false } } }];

/** Hooks transform before retention; oversized results become retrievable references rather than cuts. */
export async function formatToolOutput(input: Scope & { name: string; value: unknown; inlineLimit?: number; retrievalAllowed?: boolean; resource?: string }, store = toolOutputStore): Promise<string> {
  const sanitized = serializeToolOutput(input.value);
  const transformed = await runPostToolUse({ event: "PostToolUse", toolName: input.name, output: sanitized });
  let text: string;
  try { text = serializeToolOutput(JSON.parse(transformed.output)); }
  catch { text = redactOutputText(transformed.output); }
  if (text.length <= (input.inlineLimit ?? OUTPUT_INLINE_CHARS) || input.name === "read_tool_output") return text;
  if (input.retrievalAllowed === false) throw new ToolOutputError("OUTPUT_STORAGE_UNAVAILABLE", "This tool produced a large result, but read_tool_output is disabled for this Bot. Request a smaller range or enable that reader.");
  const saved = await store.put(input, text, { tool: input.name, ...(input.resource ? { resource: input.resource } : {}) });
  return JSON.stringify({ status: "retained_output", ...saved, readTool: "read_tool_output", offsetUnit: "UTF-16 characters",
    preview: text.slice(0, 400), tail: text.slice(-1200), message: "The complete sanitized result is retained. Read or search the reference for details outside this preview." });
}
