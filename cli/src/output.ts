/** Tiny terminal output helpers. Plain text only — no color deps, respects pipes. */

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

/** Short display id: last segment after any prefix (opencode:big-pickle → big-pickle). */
export const shortModel = (id: string): string => {
  const afterColon = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  return afterColon.includes("/") ? afterColon.slice(afterColon.lastIndexOf("/") + 1) : afterColon;
};
