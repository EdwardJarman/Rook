/**
 * `rook doctor`: self-diagnose the terminal setup. Every check degrades to
 * an honest row instead of throwing, so offline machines still get the
 * config/terminal half of the report. `--json` for scripts.
 */

import { fetchMe, probeApi } from "../auth.js";
import { configPath, DEFAULT_API_URL } from "../config.js";
import type { CliProfile } from "../config.js";
import { listModels } from "./models.js";
import { bold, box, c } from "../ui.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

export type DoctorDeps = {
  probe?: (apiUrl: string) => Promise<boolean>;
  me?: (profile: CliProfile) => Promise<{ name?: string | null; email?: string | null } | null>;
  models?: (profile: CliProfile) => Promise<Array<{ id: string }>>;
};

export async function runDoctor(profile: CliProfile, deps: DoctorDeps = {}): Promise<DoctorCheck[]> {
  const probe = deps.probe ?? probeApi;
  const getMe = deps.me ?? fetchMe;
  const getModels = deps.models ?? listModels;
  const checks: DoctorCheck[] = [];

  try {
    const reachable = await probe(profile.apiUrl);
    checks.push({
      name: "Server",
      ok: reachable,
      detail: reachable
        ? `reachable at ${profile.apiUrl}`
        : `unreachable at ${profile.apiUrl} — start the dev server or pass --api-url (default ${DEFAULT_API_URL})`,
    });
  } catch (error) {
    checks.push({
      name: "Server",
      ok: false,
      detail: error instanceof Error ? error.message : "probe failed",
    });
  }

  try {
    const me = await getMe(profile);
    checks.push({
      name: "Auth",
      ok: me !== null,
      detail: me ? `signed in as ${me.name ?? "user"}${me.email ? ` <${me.email}>` : ""}` : "not signed in — run `rook login`",
    });
  } catch (error) {
    checks.push({
      name: "Auth",
      ok: false,
      detail: error instanceof Error ? error.message : "auth check failed",
    });
  }

  try {
    const models = await getModels(profile);
    checks.push({
      name: "Models",
      ok: models.length > 0,
      detail: models.length ? `${models.length} models available` : "no models — run `rook status`",
    });
  } catch (error) {
    checks.push({
      name: "Models",
      ok: false,
      detail: error instanceof Error ? error.message : "model check failed",
    });
  }

  const envBits = [
    `ROOK_API_URL ${process.env.ROOK_API_URL ? "set" : "unset"}`,
    `ROOK_TOKEN ${process.env.ROOK_TOKEN ? "set" : "unset"}`,
  ];
  checks.push({ name: "Config", ok: true, detail: `${configPath()} · ${envBits.join(" · ")}` });

  const node = process.versions.node ?? "";
  const major = Number(node.split(".")[0] ?? 0);
  const tty = process.stdin.isTTY && process.stdout.isTTY ? "interactive TTY" : "piped (plain output)";
  const unicode =
    process.platform === "win32" && process.env.ROOK_ASCII !== "1"
      ? " — set ROOK_ASCII=1 if glyphs render as boxes"
      : "";
  checks.push({
    name: "Terminal",
    ok: Number.isFinite(major) && major >= 20,
    detail: `node ${node || "?"} · ${process.platform} · ${tty}${unicode}`,
  });

  return checks;
}

export function renderDoctor(checks: DoctorCheck[], json: boolean): string {
  if (json) return JSON.stringify(checks, null, 2);
  if (!checks.length) return "No checks ran.";
  return box({
    title: "Doctor",
    lines: checks.map((check) => {
      const glyph = check.ok ? c("mint", "● OK      ") : c("coral", "✗ Attention");
      return `${glyph}  ${bold(check.name.padEnd(9))} ${c("dim", check.detail)}`;
    }),
  });
}
