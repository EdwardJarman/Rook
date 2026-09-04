import { describe, expect, it } from "vitest";

import { DRIVE_PIXEL_DELAYS, formatWorkingElapsed } from "../lib/ai-working";

describe("AI working indicator", () => {
  it("uses the supplied 3 by 3 Drive chevron wavefront", () => {
    expect(DRIVE_PIXEL_DELAYS).toEqual([
      90, 180, 270,
      0, 90, 180,
      90, 180, 270,
    ]);
  });

  it("formats real elapsed time in tenths of a second and minutes", () => {
    expect(formatWorkingElapsed(0)).toBe("0.0s");
    expect(formatWorkingElapsed(1_999)).toBe("1.9s");
    expect(formatWorkingElapsed(61_250)).toBe("1m 1.2s");
    expect(formatWorkingElapsed(-100)).toBe("0.0s");
  });
});
