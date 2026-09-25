import { describe, expect, it } from "vitest";

import {
  classifyRetryDecision,
  DOOM_LOOP_ABORT_MESSAGE,
  hasDoomLoop,
  IDLE_TIMEOUT_MESSAGE,
  isAuthAgentError,
  isIdleTimeoutError,
  isImageProcessingError,
  isPayloadTooLargeError,
  isRateLimitedError,
} from "../server/ai/agent-reliability";

describe("grok sampler guards (pure)", () => {
  it("auth errors surface, never retry", () => {
    expect(isAuthAgentError(new Error("401 Unauthorized"))).toBe(true);
    expect(isAuthAgentError(new Error("invalid api key"))).toBe(true);
    expect(isAuthAgentError(new Error("Could not decrypt the encrypted_content"))).toBe(true);
    expect(classifyRetryDecision(new Error("401 no"))).toBe("emit");
    expect(classifyRetryDecision(new Error("rate limited"))).not.toBe("emit");
  });

  it("413 / byte overflow / image errors strip images", () => {
    expect(isPayloadTooLargeError(new Error("413 Payload Too Large"))).toBe(true);
    expect(isPayloadTooLargeError(new Error("request_too_large"))).toBe(true);
    expect(isImageProcessingError(new Error("Could not process image"))).toBe(true);
    expect(isImageProcessingError(new Error("Base64 string of image cannot be decoded"))).toBe(
      true,
    );
    expect(classifyRetryDecision(new Error("413 too big"))).toBe("image-strip");
    expect(classifyRetryDecision(new Error("Could not process image: bad format"))).toBe(
      "image-strip",
    );
  });

  it("rate limits classify separately from generic retry", () => {
    expect(isRateLimitedError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitedError(new Error("capacity full"))).toBe(true);
    expect(classifyRetryDecision(new Error("429 slow"))).toBe("rate-limit");
    expect(classifyRetryDecision(new Error("503 boom"))).toBe("retry");
  });

  it("max-tokens and idle streams are fatal, never retried", () => {
    expect(classifyRetryDecision(new Error("max_tokens too large"))).toBe("fatal");
    expect(isIdleTimeoutError(new Error("Model stopped responding after 300s"))).toBe(true);
    expect(classifyRetryDecision(new Error("Model stopped responding after 300s"))).toBe("fatal");
    expect(classifyRetryDecision(new Error("some unknown config error"))).toBe("fatal");
  });

  it("doom-loop fires on N identical trailing fingerprints only", () => {
    expect(hasDoomLoop(["a:1", "a:1", "a:1"])).toBe(true);
    expect(hasDoomLoop(["a:1", "a:1", "a:1", "a:1"], 4)).toBe(true);
    expect(hasDoomLoop(["a:1", "a:2", "a:1"])).toBe(false);
    expect(hasDoomLoop(["a:1", "a:1"])).toBe(false);
    expect(hasDoomLoop([])).toBe(false);
    expect(hasDoomLoop(["", "", ""])).toBe(false);
    expect(DOOM_LOOP_ABORT_MESSAGE.length).toBeGreaterThan(20);
    expect(IDLE_TIMEOUT_MESSAGE.length).toBeGreaterThan(20);
  });
});
