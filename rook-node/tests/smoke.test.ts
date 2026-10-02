/**
 * Real-browser smoke test.
 *
 * Skips silently when a Chromium binary is not installed (CI without
 * `npx playwright install chromium`). Launches a genuine headless Chromium
 * through the production ChromiumRuntime, navigates, captures a screenshot,
 * and streams at least one CDP screencast frame.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChromiumRuntime } from "../src/runtime/chromium.js";
import { RookDatabase } from "../src/state/database.js";
import { defaultConfig, ensureWorkspace, stateDbPath } from "../src/config.js";
import { captureScreenshot, startScreencast } from "../src/screens/screencast.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rook-smoke-"));
const config = defaultConfig({
  dataHome: path.join(tmp, "data"),
  workspaceRoot: path.join(tmp, "data", "Rook"),
  requireAuth: false,
});
const db = new RookDatabase(config);
const runtime = new ChromiumRuntime(config, db, { headless: true });

const hasBrowser = (() => {
  try {
    const { chromium } = require("playwright") as typeof import("playwright");
    return Boolean(chromium.executablePath());
  } catch {
    return false;
  }
})();

describe("real Chromium smoke", () => {
  beforeAll(async () => {
    if (!hasBrowser) return;
    ensureWorkspace(config);
    await runtime.start();
  });

  afterAll(async () => {
    if (hasBrowser) await runtime.stop();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  });

  it.skipIf(!hasBrowser)("boots a real headless browser with a dedicated profile", async () => {
    expect(runtime.isRunning()).toBe(true);
    const context = runtime.getContext();
    expect(context).not.toBeNull();
    const profile = runtime.getProfilePath();
    expect(fs.existsSync(profile)).toBe(true);
  });

  it.skipIf(!hasBrowser)("navigates, screenshots, and streams a screencast frame", async () => {
    const context = runtime.getContext();
    if (!context) throw new Error("no context");
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "networkidle", timeout: 30_000 });

    const shot = await captureScreenshot(page, "jpeg");
    expect(shot.bytes).toBeGreaterThan(1_000);

    let frames = 0;
    const stop = await startScreencast(page, () => {
      frames += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await stop();
    expect(frames).toBeGreaterThan(0);

    await page.close();
  });

  it.skipIf(!hasBrowser)("persists a tab-registry checkpoint", () => {
    runtime.checkpoint(db);
    const checkpoint = db.getCheckpoint("tab-registry");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.nodeVersion).toBeTruthy();
    void stateDbPath;
  });
});
