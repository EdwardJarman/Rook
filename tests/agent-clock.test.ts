import { describe, expect, it } from "vitest";

import { agentClockContext } from "../server/integrations/excel-agent";

describe("Rook agent live clock", () => {
  const now = new Date("2026-08-19T17:07:08.456Z");

  it("provides a full request-time clock with seconds, timezone and canonical ISO time", () => {
    const clock = agentClockContext(now, "UTC");
    expect(clock).toEqual({
      iso: "2026-08-19T17:07:08.456Z",
      timeZone: "UTC",
      local: expect.stringContaining("Wednesday, 19 August 2026"),
    });
    expect(clock.local).toContain("17:07:08");
    expect(clock.local).toContain("Coordinated Universal Time");
  });

  it("uses the user timezone and safely rejects an invalid timezone", () => {
    const london = agentClockContext(now, "Europe/London");
    expect(london.timeZone).toBe("Europe/London");
    expect(london.local).toContain("18:07:08");

    const fallback = agentClockContext(now, "not/a-timezone");
    expect(fallback.timeZone).toBe("UTC");
    expect(fallback.local).toContain("17:07:08");
  });
});
