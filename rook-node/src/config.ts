import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { WORKSPACE_LAYOUT } from "./types.js";

/** Version-pinned runtime constants. */
export const ROOK_NODE_VERSION = "0.1.20";
export const PINNED_PLAYWRIGHT = "1.62.1";

/** The dedicated Rook Chromium profile lives inside the node's data home,
 * never the owner's ordinary personal Chrome profile. */
export const ROOK_PROFILE_DIR = "rook-profile";
export const ROOK_STATE_DB = "node.sqlite";

/** Default loopback gateway port. The node never exposes itself publicly. */
export const DEFAULT_GATEWAY_PORT = 37831;

export interface RookConfig {
  /** Root of the Rook workspace ("Rook/" in the docs). */
  workspaceRoot: string;
  /** Absolute path to the node data home (profile + sqlite). */
  dataHome: string;
  gatewayPort: number;
  /** When true, the gateway requires a pairing secret to connect. */
  requireAuth: boolean;
  /** Optional stable node secret override (tests). When omitted, generated. */
  nodeSecret?: string;
  /** Rook server base URL for the uplink and browser pairing. */
  serverUrl: string;
  /** When true, do not auto-launch Chromium (tests / headless CI). */
  noLaunch?: boolean;
}

/** Default Rook server. Override with ROOK_NODE_SERVER_URL or --server. */
export const DEFAULT_SERVER_URL = "https://www.rook.lighting";

/** Builds the default on-disk layout for the current machine. */
export function defaultConfig(overrides: Partial<RookConfig> = {}): RookConfig {
  const dataHome =
    overrides.dataHome ?? path.join(rookDataHomeDefault(), "Rook Node");
  const workspaceRoot = overrides.workspaceRoot ?? path.join(dataHome, "Rook");
  return {
    workspaceRoot,
    dataHome,
    gatewayPort: DEFAULT_GATEWAY_PORT,
    requireAuth: true,
    serverUrl: process.env.ROOK_NODE_SERVER_URL?.trim() || DEFAULT_SERVER_URL,
    ...overrides,
  };
}

function rookDataHomeDefault(): string {
  const base = process.env.ROOK_NODE_DATA_HOME;
  if (base) return base;
  const platform = process.platform;
  if (platform === "darwin")
    return path.join(os.homedir(), "Library", "Application Support");
  if (platform === "win32")
    return path.join(process.env.APPDATA ?? os.homedir(), "Rook");
  return path.join(os.homedir(), ".local", "share");
}

/** Resolves a workspace subdirectory, refusing to escape the root. */
export function workspaceDir(
  config: RookConfig,
  key: keyof typeof WORKSPACE_LAYOUT,
): string {
  return path.join(config.workspaceRoot, WORKSPACE_LAYOUT[key]);
}

/** Resolves a Bot-private directory under bots/<botId>/. */
export function botWorkspaceDir(config: RookConfig, botId: string): string {
  return path.join(workspaceDir(config, "bots"), botId, "workspace");
}

/** Resolves the dedicated Rook Chromium profile directory. */
export function profileDir(config: RookConfig): string {
  return path.join(config.dataHome, ROOK_PROFILE_DIR);
}

/** Resolves the durable SQLite database path. */
export function stateDbPath(config: RookConfig): string {
  return path.join(config.dataHome, ROOK_STATE_DB);
}

/** Creates all required directories for a fresh install. */
export function ensureWorkspace(config: RookConfig): void {
  for (const key of Object.keys(
    WORKSPACE_LAYOUT,
  ) as (keyof typeof WORKSPACE_LAYOUT)[]) {
    fsMkdir(workspaceDir(config, key));
  }
  for (const sub of ["workspace", "downloads", "uploads"]) {
    fsMkdir(path.join(workspaceDir(config, "bots"), "_template", sub));
  }
  fsMkdir(config.dataHome);
  fsMkdir(config.workspaceRoot);
}

function fsMkdir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Rook Node could not create ${dir}: ${(error as Error).message}`,
    );
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
