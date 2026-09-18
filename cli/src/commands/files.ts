/**
 * Agent-built files (OpenCode turns) land in the working directory with
 * collision-safe names. Server already caps count/size; this only avoids
 * clobbering the user's own files.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TurnFile = { name: string; mimeType: string; content: string };

const safeName = (name: string): string => {
  const base = name.split(/[\\/]/).pop()?.trim() || "artifact";
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "artifact";
  return clean;
};

export function saveTurnFiles(files: TurnFile[] | undefined, dir: string): string[] {
  if (!files?.length) return [];
  mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  for (const file of files) {
    const base = safeName(file.name);
    let target = join(dir, base);
    for (let i = 1; existsSync(target) && i < 100; i += 1) {
      const dot = base.lastIndexOf(".");
      target =
        dot > 0
          ? join(dir, `${base.slice(0, dot)} (${i})${base.slice(dot)}`)
          : join(dir, `${base} (${i})`);
    }
    writeFileSync(target, file.content, "utf8");
    saved.push(target);
  }
  return saved;
}
