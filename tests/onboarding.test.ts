import { describe, expect, it } from "vitest";

import {
  ONBOARDING_BOT_TEMPLATES,
  recommendedOnboardingTemplate,
} from "../lib/onboarding";

describe("onboarding recommendations", () => {
  it("defaults to the chief-of-staff template for broad or planning work", () => {
    expect(recommendedOnboardingTemplate(["plan"]).id).toBe("atlas");
    expect(recommendedOnboardingTemplate(["general"]).id).toBe("atlas");
  });

  it("prioritizes a specialist when the user chooses a clear lane", () => {
    expect(recommendedOnboardingTemplate(["research"]).id).toBe("scout");
    expect(recommendedOnboardingTemplate(["operations"]).id).toBe("steward");
    expect(recommendedOnboardingTemplate(["communication"]).id).toBe("steward");
    expect(recommendedOnboardingTemplate(["product", "research"]).id).toBe("patch");
  });

  it("ships every first-Bot template with a persisted orb identity and safety boundary", () => {
    for (const template of ONBOARDING_BOT_TEMPLATES) {
      expect(template.icon).toMatch(/^bot-orb:/);
      expect(template.approvalRule.length).toBeGreaterThan(30);
      expect(template.purpose.length).toBeGreaterThan(60);
    }
  });
});
