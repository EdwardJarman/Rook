/**
 * Network policy: the runner blocks navigation to loopback, link-local,
 * private-network, router, and cloud-metadata addresses unless the user has
 * explicitly created a local-network capability for the Bot.
 *
 * Chromium is the only network actor; we enforce policy both before launching
 * a navigation and at the CDP `Page.frameRequestedNavigation`/`Fetch` boundary.
 */
import dns from "node:dns/promises";
import net from "node:net";

export interface NetworkDecision {
  allowed: boolean;
  reason: "public" | "local-network-capability" | "denied-loopback" | "denied-private" | "denied-link-local" | "denied-cloud-metadata" | "denied-dns-failure";
}

const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google.internal.",
  "instance-data",
  "instance-data.",
  "fd00:ec2::254",
  "100.100.100.200",
  "100.100.100.200.",
]);

function classifyIpv4(ip: string): NetworkDecision["reason"] {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return "denied-dns-failure";
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return "denied-dns-failure";
  // loopback 127.0.0.0/8
  if (a === 127) return "denied-loopback";
  // link-local 169.254.0.0/16
  if (a === 169 && b === 254) return "denied-link-local";
  // private 10.0.0.0/8
  if (a === 10) return "denied-private";
  // private 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return "denied-private";
  // private 192.168.0.0/16
  if (a === 192 && b === 168) return "denied-private";
  // 0.0.0.0/8
  if (a === 0) return "denied-loopback";
  // 100.64.0.0/10 carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return "denied-private";
  return "public";
}

function classifyIpv6(ip: string): NetworkDecision["reason"] {
  const lower = ip.toLowerCase();
  if (lower === "::1") return "denied-loopback";
  if (lower.startsWith("fe80:")) return "denied-link-local";
  if (lower.startsWith("fc") || lower.startsWith("fd")) return "denied-private";
  if (lower.startsWith("::ffff:127.")) return "denied-loopback";
  return "public";
}

export function classifyIp(ip: string): NetworkDecision["reason"] {
  const normalized = ip.trim();
  if (normalized.includes(":")) return classifyIpv6(normalized);
  return classifyIpv4(normalized);
}

/** Hostname-level blocklist applied before any DNS work. */
export function blocklistedHostname(host: string): NetworkDecision["reason"] | undefined {
  const lower = host.toLowerCase().replace(/\.$/, "");
  if (CLOUD_METADATA_HOSTS.has(lower)) return "denied-cloud-metadata";
  if (lower === "localhost" || lower === "localhost." || lower === "ip6-localhost") return "denied-loopback";
  if (lower.endsWith(".local")) return "denied-link-local";
  return undefined;
}

export async function resolveDecision(hostname: string): Promise<NetworkDecision["reason"] | undefined> {
  const blocked = blocklistedHostname(hostname);
  if (blocked) return blocked;
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (addresses.length === 0) return "denied-dns-failure";
    let firstPublic: "public" | undefined;
    for (const entry of addresses) {
      const reason = classifyIp(entry.address);
      if (reason !== "public") return reason;
      firstPublic = "public";
    }
    return firstPublic;
  } catch {
    return "denied-dns-failure";
  }
}

/** Decides whether the node may navigate to the given URL. */
export function evaluateUrl(url: string): NetworkDecision {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "denied-dns-failure" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    return { allowed: false, reason: "denied-dns-failure" };
  }
  if (parsed.protocol === "file:") {
    // File navigation is only allowed through the broker's opaque IDs, never
    // via raw paths supplied by model output. Deny by default.
    return { allowed: false, reason: "denied-dns-failure" };
  }
  const host = parsed.hostname;
  const blocked = blocklistedHostname(host);
  if (blocked) return { allowed: false, reason: blocked };
  if (net.isIP(host) !== 0) {
    const reason = classifyIp(host);
    return reason === "public" ? { allowed: true, reason: "public" } : { allowed: false, reason };
  }
  // Hostname; decision deferred to DNS resolution by the caller.
  return { allowed: true, reason: "public" };
}

export async function evaluateUrlWithDns(url: string): Promise<NetworkDecision> {
  const staticDecision = evaluateUrl(url);
  if (!staticDecision.allowed) return staticDecision;
  try {
    const parsed = new URL(url);
    const reason = await resolveDecision(parsed.hostname);
    if (reason && reason !== "public") return { allowed: false, reason };
    return { allowed: true, reason: "public" };
  } catch {
    return { allowed: false, reason: "denied-dns-failure" };
  }
}