/**
 * Rook Node shared-computer context for the agent system prompt.
 *
 * This is the "AI doesn't know it has a computer" fix: every chat turn now
 * injects the user's REAL pairing state (from InstantDB via `db`) so the
 * model stops guessing and stops claiming it has no computer when one is
 * paired — or claiming it browsed somewhere when none is.
 *
 * Deliberately narrow: names + online/offline + recency only. No secrets,
 * tokens, envelopes, or command history ever reach the model.
 */

import * as db from "../db";

export type ComputerPromptState = {
  paired: boolean;
  online: boolean;
  /** Short human-readable block dropped into the system prompt. */
  block: string;
};

const RECENCY = (value: unknown): string | null => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const minutes = Math.max(0, Math.round((Date.now() - value.getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export async function getComputerPromptState(userId: string): Promise<ComputerPromptState> {
  let nodes: Awaited<ReturnType<typeof db.listRookNodesForUser>> = [];
  try {
    nodes = await db.listRookNodesForUser(userId);
  } catch {
    return {
      paired: false,
      online: false,
      block:
        "Rook Node computer status is temporarily unavailable. Do not claim computer access either way; answer from chat context and offer to retry.",
    };
  }

  const active = nodes.filter((node) => node.status !== "revoked");
  if (!active.length) {
    return {
      paired: false,
      online: false,
      block:
        "No Rook Node computer is paired to this account yet. You do NOT currently have a live browser, filesystem, or terminal to act through. If the user asks for computer/browser work (open a site, click, fill a form, download/upload, run something on their machine), say plainly that no computer is connected and guide them: install/open Rook Node → press Connect account → approve the pairing. Do not hallucinate browsing, screenshots, or files.",
    };
  }

  const online = active.filter((node) => node.status === "online");
  const names = (list: typeof active) =>
    list
      .slice(0, 3)
      .map((node) => `“${node.name || "Computer"}”`)
      .join(", ");

  if (!online.length) {
    const lastSeen = active
      .map((node) => RECENCY((node as { lastSeenAt?: unknown }).lastSeenAt))
      .find(Boolean);
    return {
      paired: true,
      online: false,
      block: `A Rook Node computer IS paired (${names(active)}) but it is currently OFFLINE${lastSeen ? ` (last seen ${lastSeen})` : ""}. You do not have a live browser right now. Say the computer is offline in one line, preserve any checkpointed context, and tell the user to wake/open Rook Node — work resumes when it returns. Do not pretend to browse while offline.`,
    };
  }

  return {
    paired: true,
    online: true,
    block: `A Rook Node shared computer IS paired and ONLINE (${names(online)}). Capabilities available through the user's Computer panel: supervised Chromium browsing (each Bot has its own tabs), shared + Bot-private files, uploads/downloads with quarantine, form filling, and human takeover. Reading/scrolling may proceed; form submission, uploads, messages, purchases, deletions, permission/security changes, and irreversible actions ALWAYS pause for the user's approval first (short-lived, bound to the page). Guide the user to watch/take over in the Computer panel when needed. Never claim you already clicked/submitted/uploaded something — describe the plan and let the approval/computer flow confirm it.`,
  };
}
