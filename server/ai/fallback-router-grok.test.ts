import { beforeEach, describe, expect, it } from "vitest";

import {
  BREAKER_MIN_SAMPLES,
  __breakerStateForTests,
  __recordBreakerOutcomeForTests,
  __resetFallbackBreakerForTests,
  __tripFallbackBreakerForTests,
  breakerShouldTrip,
} from "./fallback-router";

describe("grok circuit-breaker (min-samples + class split)", () => {
  beforeEach(() => {
    __resetFallbackBreakerForTests();
  });

  it("does not trip on 3 cold failures (min-samples guard)", () => {
    for (let i = 0; i < 3; i++) __recordBreakerOutcomeForTests("p1", "wobble");
    const state = __breakerStateForTests("p1");
    expect(state?.consecutiveFailures).toBe(3);
    expect(state?.totalSamples).toBe(3);
    expect(state?.cooledUntil ?? 0).toBeLessThanOrEqual(Date.now());
    expect(breakerShouldTrip(state!)).toBe(false);
  });

  it("trips once min-samples are met with a failing streak", () => {
    for (let i = 0; i < BREAKER_MIN_SAMPLES; i++)
      __recordBreakerOutcomeForTests("p2", "wobble");
    const state = __breakerStateForTests("p2");
    expect(state?.totalSamples).toBe(BREAKER_MIN_SAMPLES);
    expect(breakerShouldTrip(state!)).toBe(true);
    expect(state?.cooledUntil ?? 0).toBeGreaterThan(Date.now());
  });

  it("success resets the streak but keeps the sample count", () => {
    for (let i = 0; i < BREAKER_MIN_SAMPLES; i++)
      __recordBreakerOutcomeForTests("p3", "wobble");
    __recordBreakerOutcomeForTests("p3", "success");
    const state = __breakerStateForTests("p3");
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.totalSamples).toBe(BREAKER_MIN_SAMPLES + 1);
    expect(state?.cooledUntil).toBe(0);
  });

  it("forced trip still cools down (existing helper contract)", () => {
    __tripFallbackBreakerForTests("p4");
    const state = __breakerStateForTests("p4");
    expect(breakerShouldTrip(state!)).toBe(true);
    expect(state?.cooledUntil ?? 0).toBeGreaterThan(Date.now());
  });

  it("pure predicate edges", () => {
    expect(
      breakerShouldTrip({ consecutiveFailures: 9, totalSamples: 2, cooledUntil: 0 }),
    ).toBe(false);
    expect(
      breakerShouldTrip({ consecutiveFailures: 0, totalSamples: 99, cooledUntil: 0 }),
    ).toBe(false);
  });
});
