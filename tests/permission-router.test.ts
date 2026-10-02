import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = vi.hoisted(() => ({ level: "always_ask" as string }));
vi.mock("../server/db", () => ({
  getUserPermissionLevel: vi.fn(async () => saved.level),
  setUserPermissionLevel: vi.fn(async (_id: string, level: string) => { saved.level = level; return true; }),
}));

import { appRouter } from "../server/routers";
import { mintCliToken } from "../server/cli-tokens";

const caller = (authorization?: string, id = "user-1") =>
  appRouter.createCaller({
    user: { id, openId: "clerk:me", name: null, email: null, loginMethod: "clerk", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { headers: authorization ? { authorization } : {} },
    res: {},
  } as never);

beforeEach(() => {
  saved.level = "always_ask";
  vi.stubEnv("ROOK_CLI_TOKEN_SECRET", "test-secret");
});

describe("permissions router", () => {
  it("defaults new users to Always ask and persists an explicit session change", async () => {
    expect(await caller("Bearer session").permissions.get()).toEqual({ level: "always_ask", ceiling: "full" });
    await caller("Bearer session").permissions.set({ level: "auto" });
    expect((await caller("Bearer session").permissions.get()).level).toBe("auto");
  });

  it("refuses level changes and grant minting from a bearer token (no self-elevation)", async () => {
    const token = `Bearer ${mintCliToken("clerk:me").token}`;
    await expect(caller(token).permissions.set({ level: "full" })).rejects.toThrow(/signed-in session/);
    await expect(caller(token).auth.createCliToken({ permissionGrant: "full" })).rejects.toThrow(/signed-in session/);
    expect(saved.level).toBe("always_ask");
  });

  it("refuses to save for transient accounts and rejects unknown levels", async () => {
    await expect(caller("Bearer session", "transient:clerk:x").permissions.set({ level: "full" })).rejects.toThrow();
    await expect(caller("Bearer session").permissions.set({ level: "root" as never })).rejects.toThrow();
  });

  it("a session can mint a token with an explicit grant, which stays capped by the token", async () => {
    const minted = await caller("Bearer session").auth.createCliToken({ permissionGrant: "auto" });
    const { credentialCeiling } = await import("../server/integrations/permission-gate");
    expect(credentialCeiling(`Bearer ${minted.token}`)).toBe("auto");
    expect(await caller(`Bearer ${minted.token}`).permissions.get()).toMatchObject({ ceiling: "auto" });
  });
});
