import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getUserByOpenId: vi.fn(),
}));

import { getUserByOpenId } from "./db";
import { authenticateCliToken, authenticateClerkRequest } from "./clerk-auth";
import { mintCliToken } from "./cli-tokens";

const mockDb = vi.mocked(getUserByOpenId);

const reqWithBearer = (token?: string) =>
  ({ header: (name: string) => (name === "authorization" && token ? `Bearer ${token}` : undefined) }) as unknown as Parameters<
    typeof authenticateClerkRequest
  >[0];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.env.ROOK_CLI_TOKEN_SECRET = "test-secret-for-unit-tests-only";
  mockDb.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.ROOK_CLI_TOKEN_SECRET;
});

describe("cli token request auth", () => {
  it("returns the stored user when the openId exists", async () => {
    const stored = { id: "user-1", openId: "clerk:abc" };
    mockDb.mockResolvedValueOnce(stored as never);
    const { token } = mintCliToken("clerk:abc", "laptop");
    const user = await authenticateCliToken(token);
    expect(user).toEqual(stored);
    expect(mockDb).toHaveBeenCalledWith("clerk:abc");
  });

  it("falls back to a transient cli user when the db misses or fails", async () => {
    mockDb.mockResolvedValueOnce(undefined);
    const user = await authenticateCliToken(mintCliToken("clerk:abc").token);
    expect(user?.id).toBe("cli:clerk:abc");
    expect(user?.loginMethod).toBe("cli");

    mockDb.mockRejectedValueOnce(new Error("db down"));
    const fallback = await authenticateCliToken(mintCliToken("clerk:abc").token);
    expect(fallback?.id).toBe("cli:clerk:abc");
  });

  it("rejects forged tokens", async () => {
    expect(await authenticateCliToken("rook_forged.payload")).toBeNull();
    expect(await authenticateCliToken("not-a-token")).toBeNull();
  });

  it("routes rook_ bearers to cli auth inside the main entry", async () => {
    mockDb.mockResolvedValueOnce(undefined);
    const { token } = mintCliToken("clerk:abc");
    const user = await authenticateClerkRequest(reqWithBearer(token));
    expect(user?.loginMethod).toBe("cli");
  });

  it("still rejects missing credentials without a clerk secret", async () => {
    delete process.env.CLERK_SECRET_KEY;
    expect(await authenticateClerkRequest(reqWithBearer(undefined))).toBeNull();
  });
});
