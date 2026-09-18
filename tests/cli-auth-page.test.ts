import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const layout = readFileSync(resolve(process.cwd(), "app/_layout.tsx"), "utf8");
const page = readFileSync(resolve(process.cwd(), "app/cli-auth.tsx"), "utf8");

describe("cli device approval page", () => {
  it("is exempt from every auth/onboarding/workroom redirect gate", () => {
    // A pairing handoff must survive signed-out, mid-onboarding, and
    // offline-workroom states — otherwise the approval strands the CLI.
    const gateHits = layout.match(/route(?:ForGate)? === "cli-auth"/g) ?? [];
    expect(gateHits.length).toBeGreaterThanOrEqual(2);
    expect(layout).toContain('<Stack.Screen name="cli-auth" />');
  });

  it("guides instead of blanking when params or session are missing", () => {
    expect(page).toContain("Start there first");
    expect(page).toContain("Sign in first");
    expect(page).toContain("parseCallbackPort");
  });

  it("warns before approving into a dead terminal", () => {
    expect(page).toContain("isTerminalAlive");
    expect(page).toContain("terminalGone");
    expect(page).toContain("looks closed");
  });

  it("always offers a manual token fallback when the terminal is gone", () => {
    expect(page).toContain("rook login --token");
    expect(page).toContain("Copy token");
    expect(page).toContain("deliverCliApproval");
  });
});
