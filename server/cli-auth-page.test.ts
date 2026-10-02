import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "server/cli-auth-page.ts"), "utf8");
const app = readFileSync(resolve(process.cwd(), "server/_core/app.ts"), "utf8");

describe("static CLI approval page", () => {
  it("is served by the API at /api/cli-auth", () => {
    expect(page).toContain('app.get("/api/cli-auth"');
    expect(app).toContain("registerCliAuthRoute(app)");
  });

  it("renders instantly with zero app-bundle dependencies", () => {
    // Inline CSS + one external script (Clerk.js). Concatenated below so this
    // file's own comments never trip the assertion.
    expect(page).toContain("<style>");
    expect(page).not.toContain("expo" + "-router");
    expect(page).not.toContain("react-" + "native");
    const scriptTags = page.match(/<script\b/g) ?? [];
    expect(scriptTags.length).toBeLessThanOrEqual(2); // Clerk CDN + inline logic
  });

  it("escapes the device code before embedding it in HTML", () => {
    expect(page).toContain("escapeHtml");
    expect(page).toContain("&amp;");
    expect(page).toContain("&lt;");
  });

  it("approves through the same tRPC deviceApprove procedure", () => {
    expect(page).toContain("/api/trpc/auth.deviceApprove");
    expect(page).toContain("Bearer ");
    expect(page).toContain("Device connected");
  });

  it("uses the same Clerk publishable key resolution as the app", () => {
    expect(page).toContain("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(page).toContain("CLERK_PUBLISHABLE_KEY");
    expect(page).toContain("pk_test_aW5zcGlyZWQ"); // checked-in dev fallback
  });
});
