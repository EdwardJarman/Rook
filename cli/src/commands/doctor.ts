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
  probe?: (apiUrl: string, timeoutMs?: number) => Promise<boolean>;
  me?: (profile: CliProfile) => Promise<{ name?: string | null; email?: string | null } | null>;
  models?: (profile: CliProfile) => Promise<Array<{ id: string }>>;
};

/**
 * Cold serverless starts routinely outrun a snappy budget (production
 * /api/health measures ~2s warm); the health probe gets room to answer
 * so it doesn't cry wolf on every cold start.
 */
const DOCTOR_PROBE_TIMEOUT_MS = 10_000;

export async function runDoctor(profile: CliProfile, deps: DoctorDeps = {}): Promise<DoctorCheck[]> {
  const probe = deps.probe ?? probeApi;
  const getMe = deps.me ?? fetchMe;
  const getModels = deps.models ?? listModels;

  let serverReachable = false;
  let serverDetail = "";
  try {
    serverReachable = await probe(profile.apiUrl, DOCTOR_PROBE_TIMEOUT_MS);
  } catch (error) {
    serverDetail = error instanceof Error ? error.message : "probe failed";
  }
  if (!serverReachable && !serverDetail) {
    serverDetail = `unreachable at ${profile.apiUrl} — start the dev server or pass --api-url (default ${DEFAULT_API_URL})`;
  }

  let meEvidence = false;
  let authCheck: DoctorCheck;
  try {
    const me = await getMe(profile);
    // Only a successful round trip is evidence: `null` also covers
    // "no token configured", which never touched the network.
    meEvidence = me !== null;
    authCheck = {
      name: "Auth",
      ok: me !== null,
      detail: me ? `signed in as ${me.name ?? "user"}${me.email ? ` <${me.email}>` : ""}` : "not signed in — run `rook login`",
    };
  } catch (error) {
    authCheck = {
      name: "Auth",
      ok: false,
      detail: error instanceof Error ? error.message : "auth check failed",
    };
  }

  let modelsEvidence = false;
  let modelsCheck: DoctorCheck;
  try {
    const models = await getModels(profile);
    // A completed round trip is evidence even with an empty catalog —
    // the server answered; it just has nothing to list.
    modelsEvidence = true;
    modelsCheck = {
      name: "Models",
      ok: models.length > 0,
      detail: models.length ? `${models.length} models available` : "no models — run `rook status`",
    };
  } catch (error) {
    modelsCheck = {
      name: "Models",
      ok: false,
      detail: error instanceof Error ? error.message : "model check failed",
    };
  }

  // A diagnostic that cries wolf trains users to ignore it. If the health
  // probe failed but real API calls against the same URL just succeeded,
  // the server is up — report what actually happened.
  if (!serverReachable && (meEvidence || modelsEvidence)) {
    serverReachable = true;
    serverDetail = `reachable at ${profile.apiUrl} — health probe was slow or blocked, but API calls succeeded`;
  }

  const checks: DoctorCheck[] = [
    // Reconciled rows keep their honest detail ("probe slow, API fine");
    // a clean probe falls back to the plain reachable message.
    { name: "Server", ok: serverReachable, detail: serverReachable ? (serverDetail || `reachable at ${profile.apiUrl}`) : serverDetail },
    authCheck,
    modelsCheck,
  ];

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
