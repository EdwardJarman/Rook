import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __pendingDeviceCountForTests,
  __resetDeviceChallengesForTests,
  approveDeviceChallenge,
  DEVICE_CODE_TTL_MS,
  pollDeviceChallenge,
  requestDeviceChallenge,
} from "./cli-device";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __resetDeviceChallengesForTests();
  process.env.ROOK_CLI_TOKEN_SECRET = "test-secret-for-unit-tests-only";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  __resetDeviceChallengesForTests();
  delete process.env.ROOK_CLI_TOKEN_SECRET;
});

describe("device-code login", () => {
  it("runs challenge → poll-pending → approve → poll-approved → consumed", () => {
    const { code, expiresInSec } = requestDeviceChallenge();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(expiresInSec).toBeGreaterThan(0);
    expect(pollDeviceChallenge(code)).toEqual({ status: "pending" });

    const minted = approveDeviceChallenge(code, "clerk:user-1", "laptop");
    expect(minted.token.startsWith("rook_")).toBe(true);

    const picked = pollDeviceChallenge(code);
    expect(picked.status).toBe("approved");
    if (picked.status === "approved") {
      expect(picked.token).toBe(minted.token);
    }
    // Single-use: second poll finds nothing.
    expect(pollDeviceChallenge(code)).toEqual({ status: "expired" });
  });

  it("normalizes codes loosely but rejects unknown ones", () => {
    const { code } = requestDeviceChallenge();
    expect(pollDeviceChallenge(code.toLowerCase().replace("-", " ")).status).toBe("pending");
    expect(pollDeviceChallenge("ZZZZ-9999").status).toBe("expired");
    expect(() => approveDeviceChallenge("nope-1234", "clerk:x")).toThrow(/unknown or expired/);
  });

  it("expires challenges after the TTL", () => {
    const { code } = requestDeviceChallenge();
    vi.setSystemTime(Date.now() + DEVICE_CODE_TTL_MS + 1_000);
    expect(pollDeviceChallenge(code)).toEqual({ status: "expired" });
    expect(() => approveDeviceChallenge(code, "clerk:x")).toThrow(/unknown or expired/);
  });

  it("rejects double approval", () => {
    const { code } = requestDeviceChallenge();
    approveDeviceChallenge(code, "clerk:user-1");
    expect(() => approveDeviceChallenge(code, "clerk:user-1")).toThrow(/already used/);
  });

  it("caps pending challenges", () => {
    for (let i = 0; i < 120; i += 1) requestDeviceChallenge();
    expect(__pendingDeviceCountForTests()).toBeLessThanOrEqual(100);
  });
});
