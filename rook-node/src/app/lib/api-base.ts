/**
 * Resolves the Rook server base URL.
 *
 * Vite env precedence:
 *   1. VITE_API_BASE_URL (explicit override; baked at build time)
 *   2. window.location origin — ONLY when it is an actual Rook host
 *      (the web app served from rook.lighting, or localhost dev servers)
 *   3. https://www.rook.lighting (production default)
 *
 * The Tauri shell serves the UI from http://tauri.localhost, which is NOT
 * an API host — using it as the base silently sent every tRPC call (chat
 * replies included) to a dead host and reduced the assistant to the
 * offline echo.
 */
export function getApiBaseUrl(): string {
  const env = (import.meta as unknown as { env: Record<string, string> }).env;
  const explicit = env.VITE_API_BASE_URL ?? env.EXPO_PUBLIC_API_BASE_URL ?? "";
  if (explicit) return explicit.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin;
    const isRookHost = /(^|\.)rook\.lighting$/.test(new URL(origin).hostname);
    const isLocalDev = /^(localhost|127\.0\.0\.1)$/.test(new URL(origin).hostname);
    if (isRookHost || isLocalDev) return origin;
  }
  return "https://www.rook.lighting";
}
