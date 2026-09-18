/**
 * One-liner install commands for the Rook CLI, pointed at whichever Rook
 * server is actually serving this page — production origin in prod,
 * localhost:3000 API in local dev. Pure (no Expo/native imports) so the
 * resolution stays unit-testable under plain vitest.
 */

import { resolveApiBaseUrl } from "./oauth-url";

export const PROD_ROOK_ORIGIN = "https://www.rook.lighting";

export function installApiBaseUrl(parts: {
  protocol?: string;
  hostname?: string;
  port?: string;
}): string {
  const resolved = resolveApiBaseUrl({
    configuredBaseUrl: "",
    platform: "web",
    protocol: parts.protocol,
    hostname: parts.hostname,
    port: parts.port,
    devApiPort: "3000",
  });
  if (resolved) return resolved;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return PROD_ROOK_ORIGIN;
}

export function cliInstallCommands(apiBase: string): {
  posix: string;
  powershell: string;
} {
  const base = apiBase.trim().replace(/\/+$/, "") || PROD_ROOK_ORIGIN;
  return {
    posix: `curl -fsSL ${base}/api/download/cli/install.sh | sh`,
    powershell: `irm ${base}/api/download/cli/install.ps1 | iex`,
  };
}
