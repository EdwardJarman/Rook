/**
 * Resolves the Rook server base URL.
 *
 * Vite env precedence:
 *   1. VITE_API_BASE_URL (explicit override; baked at build time)
 *   2. window.location origin (when serving from the same host as the API)
 *   3. https://www.rook.lighting (production default)
 */
export function getApiBaseUrl(): string {
  const env = (import.meta as unknown as { env: Record<string, string> }).env;
  const explicit = env.VITE_API_BASE_URL ?? env.EXPO_PUBLIC_API_BASE_URL ?? "";
  if (explicit) return explicit.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "https://www.rook.lighting";
}
