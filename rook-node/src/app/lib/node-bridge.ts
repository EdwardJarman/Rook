/**
 * Bridge between the Vite/React app and the Tauri shell.
 *
 * In production the Tauri shell exposes:
 *   - `get_node_status`      → { running, listening, paired, error, ... }
 *   - `start_sidecar`         → spawns/adopts the sidecar
 *   - `stop_sidecar`          → stops the sidecar
 *   - `open_connect`          → opens the user's default browser to the
 *                               local connect URL
 *   - `pick_folder`           → native folder picker, returns the absolute
 *                               path or null
 *   - `list_dir`              → list entries inside a folder the user has
 *                               previously linked (scoped by the shell)
 *   - `read_text_file`        → read a small text file
 *   - `write_text_file`       → write a small text file
 *   - `open_path`             → reveal/open a path in the OS file manager
 *
 * When the app is loaded outside Tauri (e.g. `vite preview`), these calls
 * fall back to a no-op that uses the loopback gateway directly. This keeps
 * the development experience smooth.
 */
import { getApiBaseUrl } from "./api-base";

const GATEWAY_PORT = 37831;
const GATEWAY_HOSTS = [
  `http://127.0.0.1:${GATEWAY_PORT}`,
  `http://localhost:${GATEWAY_PORT}`,
];

export type NodeStatus = {
  running: boolean;
  listening: boolean;
  paired: boolean;
  nodeId?: string;
  serverUrl?: string;
  dataHome?: string;
  version?: string;
  error?: string;
  bots?: number;
  tabs?: number;
  pendingApprovals?: number;
};

export type FileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
};

type TauriCore = {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

function getTauri(): TauriCore | null {
  if (typeof window === "undefined") return null;
  // Tauri 2 — global available via withGlobalTauri: true
  const w = window as unknown as {
    __TAURI__?: { core?: TauriCore; invoke?: TauriCore["invoke"] };
  };
  if (w.__TAURI__?.core?.invoke) return w.__TAURI__.core;
  if (typeof w.__TAURI__?.invoke === "function") {
    const invoke = w.__TAURI__.invoke;
    return { invoke };
  }
  return null;
}

async function gateway<T>(path: string, init?: RequestInit): Promise<T | null> {
  for (const base of GATEWAY_HOSTS) {
    try {
      const res = await fetch(`${base}${path}`, {
        cache: "no-store",
        ...init,
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          return (await res.json()) as T;
        }
        return (await res.text()) as unknown as T;
      }
    } catch {
      // try the next host
    }
  }
  return null;
}

export async function getNodeStatus(): Promise<NodeStatus> {
  const tauri = getTauri();
  if (tauri) {
    try {
      const raw = await tauri.invoke("get_node_status");
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw) as NodeStatus;
        } catch {
          /* fall through */
        }
      }
      if (raw && typeof raw === "object") return raw as NodeStatus;
    } catch (err) {
      return {
        running: false,
        listening: false,
        paired: false,
        error: (err as Error).message,
      };
    }
  }
  const status = await gateway<NodeStatus & { ok?: boolean }>("/api/status");
  if (status && status.ok) {
    return {
      running: true,
      listening: true,
      paired: Boolean(status.paired),
      nodeId: (status as Record<string, unknown>).nodeId as string | undefined,
      serverUrl:
        ((status as Record<string, unknown>).serverUrl as string | undefined) ??
        getApiBaseUrl(),
      version: (status as Record<string, unknown>).version as string | undefined,
    };
  }
  return { running: false, listening: false, paired: false };
}

export async function startSidecar(): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    await tauri.invoke("start_sidecar");
  }
}

export async function stopSidecar(): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    await tauri.invoke("stop_sidecar");
  }
}

export async function openConnect(): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    await tauri.invoke("open_connect");
    return;
  }
  // Fallback: open the loopback connect page directly.
  if (typeof window !== "undefined") {
    window.open(`${GATEWAY_HOSTS[0]}/connect`, "_blank", "noopener");
  }
}

export async function pickFolder(): Promise<string | null> {
  const tauri = getTauri();
  if (tauri) {
    const res = (await tauri.invoke("pick_folder")) as unknown;
    if (typeof res === "string") return res;
    return null;
  }
  // Web fallback: no native folder picker; return null so the UI can show
  // a "this only works inside the desktop app" hint.
  return null;
}

export async function listDir(path: string): Promise<FileEntry[]> {
  const tauri = getTauri();
  if (tauri) {
    const res = (await tauri.invoke("list_dir", { path })) as
      | { entries?: FileEntry[] }
      | null;
    return res?.entries ?? [];
  }
  return [];
}

export async function readTextFile(path: string): Promise<string> {
  const tauri = getTauri();
  if (tauri) {
    const res = (await tauri.invoke("read_text_file", { path })) as unknown;
    if (typeof res === "string") return res;
    return "";
  }
  return "";
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    await tauri.invoke("write_text_file", { path, contents });
  }
}

export async function openPath(path: string): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    await tauri.invoke("open_path", { path });
    return;
  }
  if (typeof window !== "undefined") {
    window.open(`file://${path}`, "_blank", "noopener");
  }
}

export async function disconnect(): Promise<void> {
  const tauri = getTauri();
  if (tauri) {
    try {
      await tauri.invoke("disconnect_node");
      return;
    } catch {
      // Fall through to the gateway HTTP call below.
    }
  }
  await gateway("/api/disconnect", { method: "POST" });
}

export type LeaseRecord = {
  botId: string;
  state: "NONE" | "BOT" | "HUMAN" | "PAUSED";
  fencing: number;
  holderDeviceId: string;
  updatedAt: string;
};

/** Every Bot's current control lease, so the UI can show a takeover banner. */
export async function listLeases(): Promise<LeaseRecord[]> {
  const result = await gateway<{ leases?: LeaseRecord[] }>("/api/leases");
  return result?.leases ?? [];
}

/** Human takeover: pause the Bot's input and give control to this desktop window. */
export async function takeOverBot(botId: string): Promise<boolean> {
  const result = await gateway<{ ok?: boolean }>("/api/take-over", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ botId }).toString(),
  });
  return Boolean(result?.ok);
}

/** Release control back to the Bot. */
export async function releaseBot(botId: string): Promise<boolean> {
  const result = await gateway<{ ok?: boolean }>("/api/release", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ botId }).toString(),
  });
  return Boolean(result?.ok);
}

export function isTauri(): boolean {
  return getTauri() !== null;
}

export const GATEWAY_BASE = GATEWAY_HOSTS[0];
