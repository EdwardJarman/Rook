/**
 * Scenario world for the probe. Only connector BACKENDS are stubbed (what a
 * workbook, repo or computer would return); the real dispatcher, argument
 * validation, policy checks, approval caps, retention and skills all run, so
 * tool errors and invalid arguments are measured on production code paths.
 * No stub ever touches a network, database or connector.
 */

export type Call = { tool: string; args: Record<string, unknown> };
export type Backend = Record<string, (args: Record<string, unknown>) => unknown>;
export type World = {
  /** Present means Excel is connected; entries answer read tools. */
  excel?: Backend;
  github?: { repos: string[]; tools: Backend };
  computer?: { online: boolean; tools: Backend };
  search?: Array<{ title: string; url: string; snippet: string }>;
};

export const probeWorld: { current: World; calls: Call[] } = { current: {}, calls: [] };

export const setWorld = (world: World): void => {
  probeWorld.current = world;
  probeWorld.calls = [];
};

export function recordCall(tool: string, rawArgs: string): void {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch { /* invalid JSON is itself the observation */ }
  probeWorld.calls.push({ tool, args });
}

const missing = (kind: string, name: string): never => {
  throw new Error(`Scenario provides no ${kind} data for ${name}.`);
};

export const runBackend = (kind: "excel" | "github" | "computer", name: string, args: Record<string, unknown>): unknown => {
  const world = probeWorld.current;
  const table = kind === "excel" ? world.excel : kind === "github" ? world.github?.tools : world.computer?.tools;
  const handler = table?.[name];
  return handler ? handler(args) : missing(kind, name);
};

export const excelStatus = () => probeWorld.current.excel
  ? { configured: true, connected: true, needsReauthorization: false, displayName: "Eval User", email: "eval@example.test", scopes: [], connectedAt: null,
      accounts: [{ accountId: "acct-eval", displayName: "Eval User", email: "eval@example.test", status: "connected", isPrimary: true, connectedAt: "2026-01-01T00:00:00.000Z" }] }
  : { configured: true, connected: false, needsReauthorization: false, displayName: null, email: null, scopes: [], connectedAt: null, accounts: [] };

export const githubStatus = () => probeWorld.current.github
  ? { configured: true, connected: true, needsReauthorization: false, login: "eval-user", connectedAt: null,
      selectedRepos: probeWorld.current.github.repos.map((fullName) => ({ fullName, privateRepo: false, defaultBranch: "main" })) }
  : { configured: true, connected: false, needsReauthorization: false, login: null, connectedAt: null, selectedRepos: [] };

export const rookNodes = () => probeWorld.current.computer
  ? [{ id: "node-eval", nodeId: "node-eval", name: "Studio laptop", status: probeWorld.current.computer.online ? "online" : "offline", lastSeenAt: new Date() }]
  : [];

export const searchResults = () => probeWorld.current.search ?? [];
