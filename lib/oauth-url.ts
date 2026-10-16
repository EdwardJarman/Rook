export type OAuthProvider = "google" | "github";

/**
 * Pure API-base resolver (no Expo/native dependencies, unit-tested).
 *
 * Priority:
 * 1. Explicitly configured base URL (production / tunnels).
 * 2. Hosted sandbox pattern: 8081-<id>.<domain> -> 3000-<id>.<domain>.
 * 3. Local web dev: the UI (Metro) and the API run on different ports on
 *    the same host, so same-origin would hit Metro and 404. Point at the
 *    API port instead. THIS was the "Unexpected token 'N', Not found"
 *    chat bug: every tRPC/stream call went to :8081 and got Metro's
 *    "Not found" page instead of JSON.
 * 4. Native builds without configuration: production API.
 * 5. Otherwise same-origin relative ("") for served web deployments.
 */
export function resolveApiBaseUrl(input: {
  configuredBaseUrl: string;
  platform: string;
  protocol?: string;
  hostname?: string;
  port?: string;
  devApiPort?: string;
}): string {
  const configured = (input.configuredBaseUrl ?? "").trim().replace(/\/$/, "");
  if (configured) return configured;
  const apiPort = (input.devApiPort ?? "").trim() || "3000";
  if (input.platform === "web" && input.hostname) {
    const { protocol, hostname, port } = input;
    const mapped = hostname.replace(/^8081-/, "3000-");
    if (mapped !== hostname) return `${protocol || "https:"}//${mapped}`;
    if (
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") &&
      port &&
      port !== apiPort
    ) {
      return `${protocol || "http:"}//${hostname}:${apiPort}`;
    }
  }
  if (input.platform !== "web") return "https://www.rook.lighting";
  return "";
}

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(value);
  const BufferImpl = (globalThis as Record<string, unknown>).Buffer as { from?: (value: string, encoding: string) => { toString: (encoding: string) => string } } | undefined;
  return BufferImpl?.from ? BufferImpl.from(value, "utf-8").toString("base64") : value;
};

export const buildLoginUrl = ({ portalUrl, appId, redirectUri, provider }: { portalUrl: string; appId: string; redirectUri: string; provider?: OAuthProvider }) => {
  const url = new URL(`${portalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", encodeState(redirectUri));
  url.searchParams.set("type", "signIn");
  if (provider) url.searchParams.set("provider", provider);
  return url.toString();
};
