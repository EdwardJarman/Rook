/**
 * CLI profile: where the Rook API lives and which token signs in.
 * File: <configDir>/config.json (0600 on posix). Env always wins:
 * ROOK_API_URL / ROOK_TOKEN — handy for CI and for first-run probes.
 */

import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CliProfile = {
  apiUrl: string;
  token: string | null;
};

export const DEFAULT_API_URL = "http://localhost:3000";

export function configDir(): string {
  const override = process.env.ROOK_CONFIG_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
      "rook",
    );
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "rook");
}

export const configPath = (): string => join(configDir(), "config.json");

type StoredProfile = { apiUrl?: unknown; token?: unknown };

const readStored = (): StoredProfile => {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")) as StoredProfile;
  } catch {
    return {};
  }
};

const cleanUrl = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim().replace(/\/+$/, "") : null;

export function loadProfile(): CliProfile {
  const stored = readStored();
  return {
    apiUrl:
      cleanUrl(process.env.ROOK_API_URL) ?? cleanUrl(stored.apiUrl) ?? DEFAULT_API_URL,
    token: cleanUrl(process.env.ROOK_TOKEN) ?? cleanUrl(stored.token),
  };
}

export function saveProfile(profile: CliProfile): void {
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify({ apiUrl: profile.apiUrl, token: profile.token }, null, 2)}\n`);
  try {
    chmodSync(configPath(), 0o600);
  } catch {
    // Windows ACLs: best effort only.
  }
}

export function clearProfile(): void {
  try {
    rmSync(configPath(), { force: true });
  } catch {
    // Already gone.
  }
}
