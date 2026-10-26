import { describe, expect, it } from "vitest";

import { classifyIp, evaluateUrl, evaluateUrlWithDns, blocklistedHostname } from "../src/security/network-policy.js";

describe("network policy", () => {
  it("classifies IPv4 loopback", () => {
    expect(classifyIp("127.0.0.1")).toBe("denied-loopback");
    expect(classifyIp("127.255.255.254")).toBe("denied-loopback");
  });

  it("classifies private ranges", () => {
    expect(classifyIp("10.0.0.1")).toBe("denied-private");
    expect(classifyIp("172.16.0.1")).toBe("denied-private");
    expect(classifyIp("172.31.255.255")).toBe("denied-private");
    expect(classifyIp("192.168.1.1")).toBe("denied-private");
  });

  it("classifies link-local", () => {
    expect(classifyIp("169.254.169.254")).toBe("denied-link-local");
    expect(classifyIp("169.254.0.1")).toBe("denied-link-local");
  });

  it("classifies carrier-grade NAT", () => {
    expect(classifyIp("100.64.0.1")).toBe("denied-private");
    expect(classifyIp("100.127.255.254")).toBe("denied-private");
  });

  it("classifies IPv6", () => {
    expect(classifyIp("::1")).toBe("denied-loopback");
    expect(classifyIp("fe80::1")).toBe("denied-link-local");
    expect(classifyIp("fd00::1")).toBe("denied-private");
    expect(classifyIp("fc00::1")).toBe("denied-private");
    expect(classifyIp("::ffff:127.0.0.1")).toBe("denied-loopback");
  });

  it("allows public addresses", () => {
    expect(classifyIp("8.8.8.8")).toBe("public");
    expect(classifyIp("1.1.1.1")).toBe("public");
    expect(classifyIp("2606:4700:4700::1111")).toBe("public");
  });

  it("blocks cloud metadata hostnames", () => {
    expect(blocklistedHostname("169.254.169.254")).toBe("denied-cloud-metadata");
    expect(blocklistedHostname("metadata.google.internal")).toBe("denied-cloud-metadata");
    expect(blocklistedHostname("100.100.100.200")).toBe("denied-cloud-metadata");
  });

  it("blocks localhost and .local hostnames", () => {
    expect(blocklistedHostname("localhost")).toBe("denied-loopback");
    expect(blocklistedHostname("printer.local")).toBe("denied-link-local");
  });

  it("evaluates URLs statically", () => {
    expect(evaluateUrl("http://127.0.0.1:3000/admin")).toEqual({ allowed: false, reason: "denied-loopback" });
    expect(evaluateUrl("https://192.168.1.5")).toEqual({ allowed: false, reason: "denied-private" });
    expect(evaluateUrl("http://10.0.0.1")).toEqual({ allowed: false, reason: "denied-private" });
    expect(evaluateUrl("https://www.example.com")).toEqual({ allowed: true, reason: "public" });
  });

  it("rejects non-http/file protocols", () => {
    expect(evaluateUrl("file:///C:/Windows/System32/notepad.exe").allowed).toBe(false);
    expect(evaluateUrl("javascript:alert(1)").allowed).toBe(false);
    expect(evaluateUrl("data:text/html,<b>x</b>").allowed).toBe(false);
    expect(evaluateUrl("not-a-url").allowed).toBe(false);
  });

  it("resolves hostnames with DNS and blocks private results", async () => {
    const decision = await evaluateUrlWithDns("http://localhost:8080");
    expect(decision.allowed).toBe(false);
  });
});