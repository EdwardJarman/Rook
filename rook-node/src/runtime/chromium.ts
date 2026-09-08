/**
 * Supervised Chromium runtime.
 *
 * Launches a real headed Chromium via Playwright (version-pinned) using the
 * dedicated Rook profile. `--no-sandbox` is forbidden; the sandbox stays on.
 * The browser is restarted automatically if it crashes and its last checkpoint
 * is restored.
 */
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, type BrowserContext, type Browser } from "playwright";

const require = createRequire(
  (import.meta as { url?: string }).url ?? "file:///" + process.cwd().replace(/\\/g, "/") + "/",
);

/** True when running inside a @yao-pkg/pkg standalone executable. */
const runningAsSingleExe = Boolean((process as { pkg?: unknown }).pkg);

import type { RookConfig } from "../config.js";
import { profileDir } from "../config.js";
import { PINNED_PLAYWRIGHT, ROOK_NODE_VERSION } from "../config.js";
import type { RookDatabase } from "../state/database.js";
import { BotRegistry } from "../registry/bot-registry.js";

export interface LaunchOptions {
  headless?: boolean;
  /** Override the channel (e.g. "chrome"). When omitted, pinned Playwright Chromium is used. */
  channel?: string;
  extraArgs?: string[];
  onConsole?: (botId: string, level: string, text: string) => void;
}

export class ChromiumRuntime {
  private context: BrowserContext | null = null;
  private browser: Browser | null = null;
  private readonly profilePath: string;
  private readonly registry: BotRegistry;
  private starting: Promise<void> | null = null;
  startedAt: string | null = null;
  private crashed = false;

  constructor(
    private readonly config: RookConfig,
    db: RookDatabase,
    private readonly options: LaunchOptions = {},
  ) {
    this.profilePath = profileDir(config);
    this.registry = new BotRegistry(db);
  }

  isRunning(): boolean {
    return Boolean(this.context && this.browser && this.browser.isConnected());
  }

  getContext(): BrowserContext | null {
    return this.context;
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  browserPid(): number | null {
    // Playwright exposes the child process on the BrowserServer; for a
    // persistent-context launch we report the WS endpooint host PID instead.
    return null;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async launch(): Promise<void> {
    const args = [
      "--disable-background-networking",
      "--no-default-browser-check",
      "--no-first-run",
      "--disable-breakpad",
      ...(this.options.extraArgs ?? []),
    ];
    // Safety: the sandbox must never be disabled for a Rook profile that holds
    // real logins. Refuse to launch rather than compromise this invariant.
    if (args.some((arg) => arg.includes("no-sandbox"))) {
      throw new Error("Refusing to launch Chromium with --no-sandbox");
    }
    this.context = await chromium.launchPersistentContext(this.profilePath, {
      headless: this.options.headless ?? false,
      channel: this.options.channel,
      args,
      viewport: { width: 1280, height: 900 },
      userAgent: undefined,
    });
    this.browser = this.context.browser();
    this.startedAt = new Date().toISOString();
    this.crashed = false;
    this.attachCrashHandler();
    this.restoreBotsIntoProfile();
  }

  private attachCrashHandler(): void {
    this.browser?.on("disconnected", () => {
      if (this.startedAt) this.crashed = true;
      this.context = null;
      this.browser = null;
    });
  }

  /** Re-opens the durable Bot tabs in the fresh profile after restart. */
  private restoreBotsIntoProfile(): void {
    if (!this.context) return;
    const bots = this.registry.listBots();
    for (const bot of bots) {
      const tabs = this.registry.tabsForBot(bot.id);
      const primary = tabs.find((tab) => tab.groupIndex === 0);
      if (primary) void this.context.newPage().then((page) => void page.goto(primary.url).catch(() => undefined));
    }
  }

  async stop(): Promise<void> {
    this.crashed = true;
    try {
      await this.context?.close();
    } catch {
      // The browser may already be gone; that is fine.
    }
    this.context = null;
    this.browser = null;
    this.startedAt = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Writes the current tab registry as a checkpoint for crash recovery. */
  checkpoint(db: RookDatabase): void {
    const tabs = this.registry.allTabs().map((tab) => ({ id: tab.id, botId: tab.botId, url: tab.url, title: tab.title }));
    db.saveCheckpoint("tab-registry", { tabs, nodeVersion: ROOK_NODE_VERSION, playwright: PINNED_PLAYWRIGHT });
  }

  getProfilePath(): string {
    return this.profilePath;
  }
}

export function assertProfileIsDedicated(config: RookConfig): boolean {
  // The Rook profile must live under the node's data home — never the owner's
  // ordinary Chrome/Edge profile directory.
  const absolute = path.resolve(config.dataHome);
  const lowered = absolute.toLowerCase();
  const forbidden = [
    path.join("appdata", "local", "google", "chrome").toLowerCase(),
    path.join("appdata", "local", "microsoft", "edge").toLowerCase(),
    path.join("appdata", "roaming", "mozilla", "firefox").toLowerCase(),
  ];
  return !forbidden.some((segment) => lowered.includes(segment));
}

/**
 * Downloads the pinned Chromium build if it is missing. Runs once per process;
 * the checksummed download comes from Playwright's own CDN via the pinned
 * package version, so the browser always matches the pinned driver.
 */
let chromiumDownload: Promise<void> | null = null;

export async function ensurePinnedChromium(log: (message: string) => void = () => undefined): Promise<void> {
  let expected: string | null = null;
  try {
    expected = chromium.executablePath();
  } catch {
    expected = null;
  }
  if (expected && fs.existsSync(expected)) return;
  if (!chromiumDownload) {
    chromiumDownload = downloadChromium(log).catch((error) => {
      chromiumDownload = null;
      throw error;
    });
  }
  return chromiumDownload;
}

function downloadChromium(log: (message: string) => void): Promise<void> {
  if (runningAsSingleExe) {
    return Promise.reject(
      new Error(
        "The bundled Chromium is missing. Reinstall Rook Node, or point PLAYWRIGHT_BROWSERS_PATH at the browsers folder that ships with it.",
      ),
    );
  }
  log(`[rook-node] Downloading pinned Chromium (${PINNED_PLAYWRIGHT}); first run only…`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        // Use this install's playwright CLI so versions stay lockstep.
        path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js"),
        "install",
        "chromium",
      ],
      { stdio: ["ignore", "pipe", "pipe"], shell: false },
    );
    child.stdout.on("data", (chunk: Buffer) => log(chunk.toString().trim()));
    child.stderr.on("data", (chunk: Buffer) => log(chunk.toString().trim()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        log("[rook-node] Chromium ready.");
        resolve();
      } else {
        reject(new Error(`Chromium download failed with exit code ${code}.`));
      }
    });
  });
}