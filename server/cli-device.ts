/**
 * Device-code login challenges for the Rook CLI (`rook login`).
 *
 * Why this exists: the original localhost-callback handshake died with
 * the terminal (timeout, closed window), stranding browser approvals with
 * nowhere to land. Device codes decouple the two sides completely: the
 * terminal shows a short code and polls; the browser approves whenever;
 * the terminal picks the token up. No shared timing, no dead states.
 *
 * Storage is an in-memory map (single Rook server process, dev stage):
 * challenges expire after 10 minutes and are consumed single-use.
 * Production multi-instance deployments need sticky routing or a shared
 * store — documented in docs/cli.md, not built here.
 */

import { randomBytes } from "node:crypto";

import { mintCliToken } from "./cli-tokens";

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1_000;
const MAX_PENDING_CHALLENGES = 100;
// Unambiguous alphabet: no 0/O, 1/I/L — codes are read off a terminal.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

type PendingChallenge = {
  code: string;
  createdAt: number;
  status: "pending";
};

type ApprovedChallenge = {
  code: string;
  createdAt: number;
  status: "approved";
  token: string;
  expiresAt: string;
};

const challenges = new Map<string, PendingChallenge | ApprovedChallenge>();

// Canonical form is dashless; display adds the dash. Generation and
// lookup must agree here, or every code reads as unknown.
const normalizeCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const formatDeviceCode = (code: string): string => {
  const clean = normalizeCode(code);
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : code;
};

const sweepExpired = (now: number): void => {
  for (const [code, entry] of challenges) {
    if (now - entry.createdAt > DEVICE_CODE_TTL_MS) challenges.delete(code);
  }
};

/** Newest insert wins; oldest pending challenges are dropped first. */
const trimToCap = (): void => {
  while (challenges.size > MAX_PENDING_CHALLENGES) {
    const oldest = challenges.keys().next();
    if (oldest.done) break;
    challenges.delete(oldest.value);
  }
};

const newCode = (): string => {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i += 1) {
    code += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  }
  return code;
};

/** Mint a fresh challenge. The displayed code carries a dash. */
export function requestDeviceChallenge(): { code: string; expiresInSec: number } {
  const now = Date.now();
  sweepExpired(now);
  let code = newCode();
  while (challenges.has(code)) code = newCode();
  challenges.set(code, { code, createdAt: now, status: "pending" });
  trimToCap();
  return { code: formatDeviceCode(code), expiresInSec: Math.floor(DEVICE_CODE_TTL_MS / 1000) };
}

/** Approve from the browser (authenticated): attaches a real CLI token. */
export function approveDeviceChallenge(
  rawCode: string,
  openId: string,
  label = "cli",
): { token: string; expiresAt: string } {
  const code = normalizeCode(rawCode);
  const entry = challenges.get(code);
  if (!entry || Date.now() - entry.createdAt > DEVICE_CODE_TTL_MS) {
    challenges.delete(code);
    throw new Error("That code is unknown or expired. Re-run `rook login` for a fresh one.");
  }
  if (entry.status !== "pending") {
    throw new Error("That code was already used. Re-run `rook login` for a fresh one.");
  }
  const minted = mintCliToken(openId, label);
  challenges.set(code, {
    code,
    createdAt: entry.createdAt,
    status: "approved",
    token: minted.token,
    expiresAt: minted.expiresAt,
  });
  return minted;
}

export type DevicePollResult =
  | { status: "pending" }
  | { status: "approved"; token: string; expiresAt: string }
  | { status: "expired" };

/** Poll from the terminal. Approved tokens are consumed single-use. */
export function pollDeviceChallenge(rawCode: string): DevicePollResult {
  const code = normalizeCode(rawCode);
  const entry = challenges.get(code);
  if (!entry || Date.now() - entry.createdAt > DEVICE_CODE_TTL_MS) {
    challenges.delete(code);
    return { status: "expired" };
  }
  if (entry.status === "approved") {
    challenges.delete(code);
    return { status: "approved", token: entry.token, expiresAt: entry.expiresAt };
  }
  return { status: "pending" };
}

export const __pendingDeviceCountForTests = (): number => challenges.size;

export const __resetDeviceChallengesForTests = (): void => {
  challenges.clear();
};
