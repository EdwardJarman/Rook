import { describe, expect, it } from "vitest";

import { clerkOpenId, extractClerkBearerToken, transientClerkUser } from "../server/clerk-auth";

describe("Clerk request helpers", () => {
  it("accepts only bearer session tokens and namespaces Clerk user identities", () => {
    expect(extractClerkBearerToken("Bearer session-token")).toBe("session-token");
    expect(extractClerkBearerToken("Basic session-token")).toBeNull();
    expect(extractClerkBearerToken(undefined)).toBeNull();
    expect(clerkOpenId("user_abc123")).toBe("clerk:user_abc123");
  });

  it("creates a stable non-database identity when persistence is unavailable", () => {
    const first = transientClerkUser({
      clerkUserId: "user_abc123",
      name: "Rook User",
      email: "user@example.com",
    });
    const second = transientClerkUser({
      clerkUserId: "user_abc123",
      name: "Rook User",
      email: "user@example.com",
    });

    expect(first.id).toBe("transient:clerk:user_abc123");
    expect(first.id).toBe(second.id);
    expect(first.openId).toBe("clerk:user_abc123");
    expect(first.email).toBe("user@example.com");
    expect(first.role).toBe("user");
  });
});
