/**
 * Per-user permission level: how often approval-gated tools pause for the user.
 * Client-safe (no server imports). The decision engine lives in
 * `server/integrations/permission-gate.ts`.
 */

export const PERMISSION_LEVELS = ["always_ask", "auto", "full"] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** New users, unknown values, and every failure path resolve here. */
export const DEFAULT_PERMISSION_LEVEL: PermissionLevel = "always_ask";

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  always_ask: "Always ask",
  auto: "Auto",
  full: "Full permission",
};

export const PERMISSION_LEVEL_HINTS: Record<PermissionLevel, string> = {
  always_ask: "Every action waits for your decision.",
  auto: "Low-risk, reversible actions run; anything else asks.",
  full: "Actions run without asking, except hard-ask ones.",
};

export const parsePermissionLevel = (value: unknown): PermissionLevel =>
  PERMISSION_LEVELS.includes(value as PermissionLevel)
    ? (value as PermissionLevel)
    : DEFAULT_PERMISSION_LEVEL;

export const permissionRank = (level: PermissionLevel): number => PERMISSION_LEVELS.indexOf(level);

/** The stricter of two levels. Combining sources can only tighten, never elevate. */
export const minPermissionLevel = (a: PermissionLevel, b: PermissionLevel): PermissionLevel =>
  permissionRank(a) <= permissionRank(b) ? a : b;
