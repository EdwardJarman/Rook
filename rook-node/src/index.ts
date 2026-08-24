/**
 * Rook Node sidecar entrypoint.
 *
 * Usage:
 *   rook-node                        # run with default config (launches Chromium)
 *   rook-node --headless             # run without a visible browser window
 *   rook-node --port 37831
 *   rook-node --server https://…     # Rook server base URL for the uplink
 *   rook-node --pair rkp-…           # one-time pairing token from the app
 *   rook-node --no-launch            # start gateway only (tests)
 *   rook-node --no-uplink            # skip the cloud control path
 *   rook-node --install              # register login-start
 *   rook-node --uninstall
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { spawn } from "node:child_process";

import { defaultConfig, type RookConfig } from "./config.js";
import { ROOK_NODE_VERSION } from "./config.js";
import { RookNode } from "./core/node.js";
import { Gateway } from "./gateway/server.js";
import { installAutostart, uninstallAutostart } from "./supervisor/autostart.js";
import { assertProfileIsDedicated } from "./runtime/chromium.js";
import { pairWithServer, UplinkClient, type CloudIdentity } from "./uplink/uplink.js";

function parseArgs(argv: string[]): {
  config: RookConfig;
  headless: boolean;
  install?: boolean;
  uninstall?: boolean;
  pairToken?: string;
  serverUrl?: string;
  noUplink: boolean;
  noOpen: boolean;
} {
  const flags = new Set(argv);
  const portArg = argv.indexOf("--port");
  const portRaw = portArg !== -1 ? argv[portArg + 1] : undefined;
  const port = portRaw ? Number.parseInt(portRaw, 10) : NaN;
  const secretArg = argv.indexOf("--secret");
  const secret = secretArg !== -1 ? argv[secretArg + 1] : undefined;
  const pairArg = argv.indexOf("--pair");
  const serverArg = argv.indexOf("--server");
  const config = defaultConfig({
    ...(Number.isFinite(port) && port > 0 ? { gatewayPort: port } : {}),
    ...(secret !== undefined ? { nodeSecret: secret } : {}),
    ...(serverArg !== -1 && argv[serverArg + 1] ? { serverUrl: argv[serverArg + 1] } : {}),
    noLaunch: flags.has("--no-launch"),
  });
  return {
    config,
    headless: flags.has("--headless"),
    install: flags.has("--install"),
    uninstall: flags.has("--uninstall"),
    pairToken: pairArg !== -1 ? argv[pairArg + 1] : undefined,
    serverUrl: serverArg !== -1 ? argv[serverArg + 1] : undefined,
    noUplink: flags.has("--no-uplink"),
    noOpen: flags.has("--no-open"),
  };
}

async function main(): Promise<void> {
  const { config, headless, install, uninstall, pairToken, serverUrl, noUplink, noOpen } = parseArgs(process.argv.slice(2));

  if (!assertProfileIsDedicated(config)) {
    console.error("[rook-node] Refusing to run: the Rook profile would collide with an ordinary browser profile.");
    process.exit(2);
  }

  const node = new RookNode(config, { headless });
  node.db.ensureNodeIdentity({
    nodeId: `node-${randomUUID()}`,
    deviceKeyId: `rkdev-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  });
  const secret = config.nodeSecret ?? process.env.ROOK_NODE_SECRET ?? generateSecret();

  if (install) {
    installAutostart();
    console.log("[rook-node] Login-start registered.");
    return;
  }
  if (uninstall) {
    uninstallAutostart();
    console.log("[rook-node] Login-start removed.");
    return;
  }

  await node.start();

  let uplink: UplinkClient | undefined;
  const startUplink = (identity: CloudIdentity): void => {
    if (uplink) return;
    uplink = new UplinkClient(node, identity, (message) => console.log(`[rook-node] ${message}`));
    uplink.start();
    console.log(`[rook-node] Uplink active → ${identity.serverUrl}`);
  };

  const gateway = new Gateway(config, node, {
    // Browser pairing lands here: the node is online the moment the browser
    // redirect completes, no restart needed.
    onPaired: (identity) => {
      console.log(`[rook-node] Paired with ${identity.serverUrl} as ${identity.nodeId}`);
      startUplink(identity);
    },
  });
  await gateway.listen();

  // ---- cloud uplink -------------------------------------------------------
  if (!noUplink) {
    const stored = node.db.getCloudIdentity();
    try {
      if (pairToken) {
        // CLI pairing: fallback for headless machines and automation.
        const identity = await pairWithServer({
          serverUrl: serverUrl ?? config.serverUrl,
          pairingToken: pairToken,
          name: hostLabel(),
          version: ROOK_NODE_VERSION,
        });
        node.db.saveCloudIdentity(identity);
        console.log(`[rook-node] Paired with ${identity.serverUrl} as ${identity.nodeId}`);
        startUplink(identity);
      } else if (stored) {
        startUplink(stored);
      } else {
        // Browser pairing: one button, no codes.
        const localUrl = `http://localhost:${config.gatewayPort}/connect`;
        console.log(`[rook-node] Not paired yet. Connect this computer here:`);
        console.log(`[rook-node]   ${localUrl}`);
        if (!noOpen) openInBrowser(localUrl);
      }
    } catch (error) {
      console.error(`[rook-node] Uplink setup failed: ${(error as Error).message}`);
    }
  }

  if (secret && !config.noLaunch) {
    console.log(`[rook-node] node-id=${node.db.getNodeIdentity()?.nodeId} port=${config.gatewayPort}`);
  }

  const shutdown = async () => {
    await gateway.close();
    await node.stop();
    node.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function generateSecret(): string {
  return `rks-${randomUUID()}${randomUUID()}`.replace(/-/g, "");
}

function hostLabel(): string {
  const raw = os.hostname().trim() || `${process.platform}-node`;
  return raw.length > 60 ? raw.slice(0, 60) : raw;
}

/** Opens the system's default browser at the given URL (best effort). */
function openInBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", shell: false }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    console.log("[rook-node] Could not open a browser automatically — open the URL above manually.");
  }
}

main().catch((error) => {
  console.error("[rook-node] Fatal:", error);
  process.exit(1);
});
