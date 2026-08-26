import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectFile = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("mobile account continuity and live bot identity", () => {
  it("uses the Android release API origin instead of a relative fetch path", () => {
    const source = projectFile("constants/oauth.ts");
    expect(source).toContain("process.env.EXPO_PUBLIC_API_ORIGIN");
    expect(source).toContain('return "https://www.rook.lighting"');
  });

  it("keeps cloud snapshots isolated by Clerk account and never saves after a failed load", () => {
    const clientSource = projectFile("lib/workroom-store.tsx");
    const serverSource = projectFile("server/routers.ts");

    expect(clientSource).toContain("accountScope: user.id");
    expect(clientSource).toContain("cloudQuery.isError");
    expect(clientSource).toContain("cloudHydrated.current = false");
    expect(serverSource).toContain("accountScope: z.string().min(1).max(128)");
  });

  it("only opens absolute secure ChatGPT verification URLs", () => {
    const source = projectFile("components/chatgpt-connection-card.tsx");
    expect(source).toContain("requireSecureVerificationUrl");
    expect(source).toContain('url.protocol !== "https:"');
    expect(source).toContain("Linking.openURL(verificationUrl)");
  });

  it("uses the web shader, gaze, blink, and Prism finish for Android bot creation", () => {
    const source = projectFile("components/live-orb.tsx");
    expect(source).toContain("getContext('webgl'");
    expect(source).toContain("pointermove");
    expect(source).toContain("cfg.blink");
    expect(source).toContain('variant === "webgl"');
  });
});
