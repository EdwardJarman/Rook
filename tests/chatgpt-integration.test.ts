import { describe, expect, it } from "vitest";

import {
  __chatGPTModelPrefixForTests,
  __openChatGPTMetadataForTests,
  __sealChatGPTMetadataForTests,
  __chatGPTSessionMetadataKeysForTests,
  __chatGPTUserSessionKeyForTests,
  chatGPTModelSlug,
  isChatGPTModel,
  userFacingChatGPTText,
} from "../server/ai/chatgpt";

describe("Login with ChatGPT integration", () => {
  it("routes only explicitly prefixed ChatGPT subscription models", () => {
    expect(__chatGPTModelPrefixForTests).toBe("chatgpt:");
    expect(isChatGPTModel("chatgpt:gpt-5.5")).toBe(true);
    expect(isChatGPTModel("openrouter/free")).toBe(false);
    expect(isChatGPTModel(undefined)).toBe(false);
    expect(chatGPTModelSlug("chatgpt:gpt-5.5-codex-fast")).toBe(
      "gpt-5.5-codex-fast",
    );
  });

  it("isolates encrypted sessions by stable, opaque Clerk user keys", () => {
    const first = __chatGPTUserSessionKeyForTests("user_alpha");
    const repeated = __chatGPTUserSessionKeyForTests("user_alpha");
    const second = __chatGPTUserSessionKeyForTests("user_beta");

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
    expect(first).not.toContain("user_alpha");
    expect(first).toMatch(/^rook_[a-f0-9]{40}$/);
    expect(__chatGPTSessionMetadataKeysForTests).toEqual({
      session: "rookChatGPTSession",
      rate: "rookChatGPTRate",
    });
  });

  it("removes Codex safety bookkeeping from the user-facing reply", () => {
    expect(
      userFacingChatGPTText(
        "User Safety: safe\nResponse Safety: safe\nHello from ChatGPT.",
      ),
    ).toBe("Hello from ChatGPT.");
    expect(
      userFacingChatGPTText("User Safety: safe\nResponse Safety: safe"),
    ).toBe("");
  });

  it("compresses and encrypts refreshable session material before metadata storage", () => {
    const previousSecret = process.env.CLERK_SECRET_KEY;
    process.env.CLERK_SECRET_KEY = "sk_test_rook-chatgpt-metadata";
    try {
      const value = {
        status: "authenticated",
        tokensPlain: {
          accessToken: "access.".repeat(450),
          refreshToken: "refresh.".repeat(450),
          idToken: "identity.".repeat(450),
        },
      };
      const sealed = __sealChatGPTMetadataForTests(value);
      expect(sealed).not.toContain("access");
      expect(Buffer.byteLength(sealed, "utf8")).toBeLessThan(7_200);
      expect(__openChatGPTMetadataForTests(sealed)).toEqual(value);

      const tamperIndex = Math.floor(sealed.length / 2);
      const original = sealed[tamperIndex] ?? "A";
      const tampered = `${sealed.slice(0, tamperIndex)}${original === "A" ? "B" : "A"}${sealed.slice(tamperIndex + 1)}`;
      expect(__openChatGPTMetadataForTests(tampered)).toBeUndefined();
    } finally {
      if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = previousSecret;
    }
  });
});
