export function cn(
  ...args: Array<string | undefined | null | false | Record<string, boolean>>
): string {
  const out: string[] = [];
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === "string") {
      out.push(arg);
    } else {
      for (const [k, v] of Object.entries(arg)) {
        if (v) out.push(k);
      }
    }
  }
  return out.join(" ");
}
