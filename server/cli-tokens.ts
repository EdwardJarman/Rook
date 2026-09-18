/**
 * Rook CLI API tokens: stateless, HMAC-signed bearers (`rook_…`).
 *
 * The CLI cannot hold a Clerk session (no browser, no refresh), so the
 * server mints long-lived opaque-to-the-client tokens instead. Stateless
 * means no database table and no lookup latency; the price is
 * no per-token server revocation in v1 — rotating the secret invalidates
 * everything (documented in docs/cli.md alongside the P2 plan).
 *
 * Secret chain: ROOK_CLI_TOKEN_SECRET → INTEGRATION_ENCRYPTION_KEY →
 * JWT_SECRET. Minting refuses when all are empty rather than signing
 * with nothing.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const CLI_TOKEN_PREFIX = "rook_";
const CLI_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1_000;

export const cliTokenSecret = (): string =>
  process.env.ROOK_CLI_TOKEN_SECRET?.trim() ||
  process.env.INTEGRATION_ENCRYPTION_KEY?.trim() ||
  process.env.JWT_SECRET?.trim() ||
  "";

export type CliTokenClaims = {
  openId: string;
  label: string;
  exp: number;
};

const b64urlEncode = (value: string | Buffer): string =>
  (typeof value === "string" ? Buffer.from(value, "utf8") : value).toString("base64url");

const b64urlDecode = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf8");

export function mintCliToken(openId: string, label = "cli"): {
  token: string;
  expiresAt: string;
} {
  const secret = cliTokenSecret();
  if (!secret) {
    throw new Error(
      "CLI token minting is not configured. Set ROOK_CLI_TOKEN_SECRET on the Rook server.",
    );
  }
  const cleanOpenId = openId.trim();
  if (!cleanOpenId) throw new Error("Cannot mint a CLI token without a user identity.");
  const exp = Date.now() + CLI_TOKEN_TTL_MS;
  const payload = b64urlEncode(JSON.stringify({ o: cleanOpenId, l: label.slice(0, 80), e: exp }));
  const sig = b64urlEncode(createHmac("sha256", secret).update(payload).digest());
  return {
    token: `${CLI_TOKEN_PREFIX}${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/** Returns claims for a valid token, or null for anything else. Never throws. */
export function verifyCliToken(token: string | undefined | null): CliTokenClaims | null {
  try {
    if (!token || !token.startsWith(CLI_TOKEN_PREFIX)) return null;
    const secret = cliTokenSecret();
    if (!secret) return null;
    const rest = token.slice(CLI_TOKEN_PREFIX.length);
    const dot = rest.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = rest.slice(0, dot);
    const sig = rest.slice(dot + 1);
    const expected = b64urlEncode(createHmac("sha256", secret).update(payload).digest());
    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const claims = JSON.parse(b64urlDecode(payload)) as { o?: unknown; l?: unknown; e?: unknown };
    if (typeof claims.o !== "string" || !claims.o || typeof claims.e !== "number") return null;
    if (claims.e <= Date.now()) return null;
    return {
      openId: claims.o,
      label: typeof claims.l === "string" ? claims.l : "cli",
      exp: claims.e,
    };
  } catch {
    return null;
  }
}
