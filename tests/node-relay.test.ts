/**
 * Shared relay protocol helpers: token lifecycle, credential verification,
 * envelope construction, and payload validation.
 */
import { describe, expect, it } from "vitest";

import {
  buildCommandEnvelope,
  buildConnectNodeUrl,
  buildPairCallbackUrl,
  generateNodeId,
  generatePairingToken,
  hashToken,
  isSensitiveCapability,
  parsePairCallback,
  parseUplinkAuth,
  validateConnectPort,
  validatePairRequest,
  validateSyncRequest,
  verifyStoredSecret,
} from "../shared/node-relay";

describe("pairing tokens", () => {
  it("generates prefixed one-time tokens and hashes them stably", () => {
    const token = generatePairingToken();
    expect(token.startsWith("rkp-")).toBe(true);
    expect(token).not.toBe(generatePairingToken());
    expect(hashToken(token)).toBe(hashToken(` ${token} `));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies plaintext credentials against stored digests", () => {
    const secret = "rks-abc123";
    const digest = hashToken(secret);
    expect(verifyStoredSecret(secret, digest)).toBe(true);
    expect(verifyStoredSecret("rks-wrong", digest)).toBe(false);
    expect(verifyStoredSecret("", "")).toBe(false);
  });
});

describe("uplink auth header", () => {
  it("parses nodeId:secret pairs and rejects malformed ones", () => {
    expect(parseUplinkAuth("Bearer node-1:rks-x")).toEqual({ nodeId: "node-1", secret: "rks-x" });
    expect(parseUplinkAuth("Bearer node-1")).toBeUndefined();
    expect(parseUplinkAuth("bearer node-1:rks-x")).toBeUndefined();
    expect(parseUplinkAuth(undefined)).toBeUndefined();
    expect(parseUplinkAuth("Bearer :")).toBeUndefined();
  });
});

describe("command envelope builder", () => {
  it("produces a version-1 envelope with cloud device binding and deadline", () => {
    const envelope = buildCommandEnvelope({
      userId: "user-1",
      botId: "bot-1",
      pageId: "tab-1",
      pageRevision: 3,
      capability: "read",
      action: { type: "readUrl" },
      seq: 7,
      ttlMs: 60_000,
    });
    expect(envelope.version).toBe(1);
    expect(envelope.deviceId).toBe("cloud");
    expect(envelope.seq).toBe(7);
    expect(envelope.pageRevision).toBe(3);
    expect((envelope.deadline as number) - (envelope.issuedAt as number)).toBe(60_000);
    expect(typeof envelope.nonce).toBe("string");
    expect((envelope.nonce as string).length).toBeGreaterThan(16);
  });

  it("clamps the command time-to-live", () => {
    const short = buildCommandEnvelope({
      userId: "u", botId: "b", pageId: "p", pageRevision: 0, capability: "read",
      action: { type: "readUrl" }, seq: 1, ttlMs: 10,
    });
    const long = buildCommandEnvelope({
      userId: "u", botId: "b", pageId: "p", pageRevision: 0, capability: "read",
      action: { type: "readUrl" }, seq: 2, ttlMs: 999_999_999,
    });
    expect((short.deadline as number) - (short.issuedAt as number)).toBe(5_000);
    expect((long.deadline as number) - (long.issuedAt as number)).toBe(120_000);
  });
});

describe("payload validation", () => {
  it("accepts a valid sync body and normalizes results", () => {
    const sync = validateSyncRequest({
      version: "0.1.0",
      health: { running: true },
      results: [{ commandId: "cmd-1", ok: true, result: { type: "readUrl" } }],
    });
    expect(sync?.results).toHaveLength(1);
    expect(sync?.results[0].commandId).toBe("cmd-1");
  });

  it("rejects malformed sync bodies", () => {
    expect(validateSyncRequest(null)).toBeUndefined();
    expect(validateSyncRequest({ version: "", results: [] })).toBeUndefined();
    expect(validateSyncRequest({ version: "1", results: "nope" })).toBeUndefined();
    expect(validateSyncRequest({ version: "1", results: [{ commandId: 5, ok: true }] })).toBeUndefined();
  });

  it("accepts only well-formed pairing requests", () => {
    expect(validatePairRequest({ pairingToken: "rkp-ok", name: "laptop", version: "0.1.0" })?.name).toBe("laptop");
    expect(validatePairRequest({ pairingToken: "nope", name: "laptop", version: "0.1.0" })).toBeUndefined();
    expect(validatePairRequest({ pairingToken: "rkp-ok", name: "", version: "0.1.0" })).toBeUndefined();
    expect(validatePairRequest("junk")).toBeUndefined();
  });
});

describe("sensitive capability gate", () => {
  it("marks real-world capabilities as sensitive", () => {
    for (const capability of ["form", "purchase", "delete", "irreversible"]) {
      expect(isSensitiveCapability(capability)).toBe(true);
    }
    for (const capability of ["read", "navigate"]) {
      expect(isSensitiveCapability(capability)).toBe(false);
    }
    expect(generateNodeId().startsWith("node-")).toBe(true);
  });
});

describe("browser pairing links", () => {
  it("builds a connect URL carrying state and loopback port", () => {
    const url = buildConnectNodeUrl({ serverUrl: "https://www.rook.lighting/", state: "s".repeat(48), port: 37831 });
    expect(url).toBe("https://www.rook.lighting/connect-node?state=" + "s".repeat(48) + "&port=37831");
  });

  it("builds a loopback callback URL with encoded params", () => {
    const url = buildPairCallbackUrl({ port: 37831, token: "rkp-a b", state: "s".repeat(48) });
    expect(url.startsWith("http://localhost:37831/pair?token=rkp-a%20b&state=")).toBe(true);
  });

  it("parses only well-formed callbacks", () => {
    const good = parsePairCallback(new URLSearchParams({ token: "rkp-abc123", state: "s".repeat(48) }));
    expect(good?.token).toBe("rkp-abc123");
    expect(parsePairCallback(new URLSearchParams({ token: "rkp-abc123", state: "short" }))).toBeUndefined();
    expect(parsePairCallback(new URLSearchParams({ state: "s".repeat(48) }))).toBeUndefined();
    expect(parsePairCallback(new URLSearchParams({ token: "garbage", state: "s".repeat(48) }))).toBeUndefined();
    expect(parsePairCallback(new URLSearchParams({ token: "rkp-" + "x".repeat(200), state: "s".repeat(48) }))).toBeUndefined();
  });

  it("accepts only sane loopback ports", () => {
    expect(validateConnectPort("37831")).toBe(37831);
    expect(validateConnectPort(49152)).toBe(49152);
    expect(validateConnectPort("80")).toBeUndefined();
    expect(validateConnectPort("99999")).toBeUndefined();
    expect(validateConnectPort("abc")).toBeUndefined();
    expect(validateConnectPort(undefined)).toBeUndefined();
  });
});
