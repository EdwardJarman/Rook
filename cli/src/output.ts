/** Tiny terminal output helpers. Plain text only — no color deps, respects pipes. */

/** Single source for --version and banners (keep in sync with package.json). */
export const ROOK_CLI_VERSION = "0.2.0";

export const println = (line = ""): void => {
  process.stdout.write(`${line}\n`);
};

export const eprintln = (line = ""): void => {
  process.stderr.write(`${line}\n`);
};

export function fatal(message: string, code = 1): never {
  eprintln(`rook: ${message}`);
  process.exit(code);
}

/** Left-aligned columns, two-space gutters. Pure function, unit-tested. */
export function renderTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) => row.map((cell, i) => (i < row.length - 1 ? cell.padEnd(widths[i]) : cell)).join("  "))
    .join("\n");
}

/**
 * Short display id: last meaningful segment (opencode:big-pickle →
 * big-pickle; cohere/north-mini-code:free → north-mini-code; the bare
 * suffixes providers append (:free, :auto) never stand alone).
 */
export const shortModel = (id: string): string => {
  const GENERIC = new Set(["free", "auto", "latest"]);
  const afterColon = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  if (!GENERIC.has(afterColon.toLowerCase()) || !afterColon.includes("/")) {
    const tail = afterColon.includes("/")
      ? afterColon.slice(afterColon.lastIndexOf("/") + 1)
      : afterColon;
    if (!GENERIC.has(tail.toLowerCase())) return tail;
  }
  const head = id.includes(":") ? id.slice(0, id.lastIndexOf(":")) : id;
  const headTail = head.includes("/") ? head.slice(head.lastIndexOf("/") + 1) : head;
  return headTail || afterColon;
};
