import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cliTokenSecret, mintCliToken, verifyCliToken } from "./cli-tokens";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.env.ROOK_CLI_TOKEN_SECRET = "test-secret-for-unit-tests-only";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.ROOK_CLI_TOKEN_SECRET;
  delete process.env.INTEGRATION_ENCRYPTION_KEY;
  delete process.env.JWT_SECRET;
});

describe("cli tokens", () => {
  it("mints and verifies a round-trip with a ~1y expiry", () => {
    const { token, expiresAt } = mintCliToken("clerk:user-123", "macbook");
    expect(token.startsWith("rook_")).toBe(true);
    const claims = verifyCliToken(token);
    expect(claims?.openId).toBe("clerk:user-123");
    expect(claims?.label).toBe("macbook");
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 3600 * 1000);
  });

  it("rejects tampered payloads and signatures", () => {
    const { token } = mintCliToken("clerk:user-123");
    const [, sig] = token.slice("rook_".length).split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({ o: "clerk:admin", l: "x", e: Date.now() + 10_000 }),
    ).toString("base64url");
    expect(verifyCliToken(`rook_${forgedPayload}.${sig}`)).toBeNull();
    const [payload] = token.slice("rook_".length).split(".");
    expect(verifyCliToken(`rook_${payload}.AAAA`)).toBeNull();
  });

  it("rejects expired tokens and non-tokens without throwing", () => {
    const { token } = mintCliToken("clerk:user-123");
    expect(verifyCliToken(token)).not.toBeNull();
    vi.setSystemTime(Date.now() + 400 * 24 * 3600 * 1000);
    expect(verifyCliToken(token)).toBeNull();
    vi.useRealTimers();
    expect(verifyCliToken(undefined)).toBeNull();
    expect(verifyCliToken("Bearer abc")).toBeNull();
    expect(verifyCliToken("rook_garbage")).toBeNull();
    expect(verifyCliToken("rook_….…")).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const { token } = mintCliToken("clerk:user-123");
    process.env.ROOK_CLI_TOKEN_SECRET = "rotated-secret";
    expect(verifyCliToken(token)).toBeNull();
  });

  it("refuses to mint without any secret and falls back down the chain", () => {
    delete process.env.ROOK_CLI_TOKEN_SECRET;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    expect(cliTokenSecret()).toBe("");
    expect(() => mintCliToken("clerk:user-123")).toThrow(/ROOK_CLI_TOKEN_SECRET/);
    expect(verifyCliToken("rook_anything.sig")).toBeNull();
    process.env.JWT_SECRET = "fallback-secret";
    const { token } = mintCliToken("clerk:user-123");
    expect(verifyCliToken(token)?.openId).toBe("clerk:user-123");
  });
});
