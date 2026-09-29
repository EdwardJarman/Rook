import { afterEach, beforeEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatToolOutput, serializeToolOutput, ToolOutputStore } from "./tool-output";
import { registerHook } from "./hooks";

let root: string, store: ToolOutputStore, now: number, sequence: number;
const scope = { userId: "owner", botId: "bot" };
const source = { tool: "fixture_read" };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "rook-output-test-")); now = Date.now(); sequence = 0;
  store = new ToolOutputStore({ root, now: () => now, id: () => (++sequence).toString(16).padStart(32, "0") });
});
afterEach(async () => {
  // Delete only the exact directory created by this test, below the known temp root.
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("rook-output-test-")) throw new Error("Unexpected test directory");
  await fs.rm(root, { recursive: true, force: true });
});
it("retains the full sanitized output and retrieves the middle beyond the old 12k cap", async () => {
  const value = { status: "completed", body: "start" + "x".repeat(20_000) + "critical-case" + "🧬".repeat(15_000) + "end" };
  const descriptor = JSON.parse(await formatToolOutput({ ...scope, name: "fixture_read", value }, store));
  expect(descriptor.status).toBe("retained_output"); expect(JSON.stringify(descriptor).length).toBeLessThan(2400);
  expect(descriptor.preview).not.toContain("critical-case"); expect(descriptor.tail).not.toContain("critical-case");
  expect((await store.read(scope, { reference: descriptor.reference, search: "critical-case", limit: 13 })).text).toBe("critical-case");
  let full = "", offset: number | null = 0;
  while (offset !== null) { const part = await store.read(scope, { reference: descriptor.reference, offset, limit: 6000 }); full += part.text; offset = part.nextOffset; }
  expect(full).toBe(JSON.stringify(value));
});
it("survives a store restart but denies other owners/Bots and expired references", async () => {
  const output = await store.put(scope, "full result", source);
  const restarted = new ToolOutputStore({ root, now: () => now, id: () => "f".repeat(32) });
  expect((await restarted.read(scope, { reference: output.reference })).text).toBe("full result");
  for (const other of [{ ...scope, userId: "other" }, { ...scope, botId: "other" }]) {
    await expect(restarted.read(other, { reference: output.reference })).rejects.toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
  }
  now = output.expiresAt;
  await expect(restarted.read(scope, { reference: output.reference })).rejects.toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
});
it("rejects path traversal, invalid ranges, missing references, and oversized retention explicitly", async () => {
  for (const reference of ["../../secret", "rook-output:../../secret", `rook-output:${"f".repeat(32)}`]) {
    await expect(store.read(scope, { reference })).rejects.toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
  }
  const output = await store.put(scope, "content", source);
  await expect(store.read(scope, { reference: output.reference, limit: 6001 })).rejects.toThrow();
  await expect(store.read(scope, { reference: output.reference, offset: -1 })).rejects.toThrow();
  await expect(store.put(scope, "x".repeat(9 * 1024 * 1024), source)).rejects.toMatchObject({ code: "OUTPUT_STORAGE_UNAVAILABLE" });
});
it("keeps credentials out of previews, retained bytes and post-hook output", async () => {
  const value = { password: "private-value", tokenCount: 14, body: 'password="private-in-text"\nBearer credential123456\n' + "x".repeat(14000) };
  const descriptor = JSON.parse(await formatToolOutput({ ...scope, name: "fixture", value }, store));
  const files = await fs.readdir(root); const disk = await fs.readFile(path.join(root, files[0]), "utf8");
  expect(disk).not.toMatch(/private-value|private-in-text|credential123456/); expect(disk).toContain("tokenCount");
  expect(JSON.stringify(descriptor)).not.toContain("private");
  const remove = registerHook({ name: "fixture", run: async () => ({ updatedOutput: JSON.stringify({ access_token: "hook-secret", body: "ok" }) }) }, "PostToolUse");
  try { expect(await formatToolOutput({ ...scope, name: "fixture", value: "before" }, store)).toBe('{"access_token":"[redacted]","body":"ok"}'); }
  finally { remove(); }
});
it("preserves small output shape and does not create an unreadable reference when the reader is denied", async () => {
  expect(await formatToolOutput({ ...scope, name: "fixture", value: { result: "ok" } }, store)).toBe('{"result":"ok"}');
  expect(await fs.readdir(root)).toEqual([]);
  await expect(formatToolOutput({ ...scope, name: "fixture", value: "x".repeat(13000), retrievalAllowed: false }, store)).rejects.toThrow("disabled");
  expect(serializeToolOutput({ text: "const tokenCount = 3;" })).toContain("tokenCount = 3");
});
it("returns a typed storage failure rather than a broken reference", async () => {
  const badRoot = path.join(root, "file"); await fs.writeFile(badRoot, "not a directory");
  const unavailable = new ToolOutputStore({ root: badRoot, now: () => now, id: () => "a".repeat(32) });
  await expect(formatToolOutput({ ...scope, name: "fixture", value: "x".repeat(13000) }, unavailable)).rejects.toMatchObject({ code: "OUTPUT_STORAGE_UNAVAILABLE" });
});
it("re-authorizes the recorded source on every read and fails closed on denial or error", async () => {
  const output = await store.put(scope, "secret rows", { tool: "github_read_file", resource: "o/r" });
  const seen: unknown[] = [];
  const allow = (source: unknown) => { seen.push(source); return true; };
  expect((await store.read(scope, { reference: output.reference }, allow)).text).toBe("secret rows");
  expect(seen).toEqual([{ tool: "github_read_file", resource: "o/r" }]);
  const foreign = await store.read({ ...scope, botId: "other" }, { reference: output.reference }).catch((e) => e);
  const denied = await store.read(scope, { reference: output.reference }, () => false).catch((e) => e);
  const broken = await store.read(scope, { reference: output.reference }, () => { throw new Error("status down"); }).catch((e) => e);
  for (const error of [foreign, denied, broken]) expect(error).toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
  // Denial is indistinguishable from a foreign scope: no oracle for what exists.
  expect(denied.message).toBe(foreign.message);
});
it("treats pre-provenance (v1) files as unavailable", async () => {
  const id = "e".repeat(32);
  await fs.writeFile(path.join(root, `${id}.json`), JSON.stringify({ version: 1, scope: "x", expiresAt: now + 1e6, text: "old" }));
  await expect(store.read(scope, { reference: `rook-output:${id}` })).rejects.toMatchObject({ code: "OUTPUT_UNAVAILABLE" });
});
