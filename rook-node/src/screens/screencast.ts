/**
 * Live screen and screenshots.
 *
 * Uses the CDP Page domain to stream only the selected page — never the OS
 * desktop or unrelated windows. Screenshots are ephemeral and are not recorded
 * by default.
 */
import type { Page } from "playwright";

export type ScreencastFrame = {
  data: string;
  sessionId: number;
  width: number;
  height: number;
};

export type ScreencastConsumer = (frame: ScreencastFrame) => void;

type ScreencastPayload = {
  data?: string;
  sessionId?: number;
  metadata?: { width?: number; height?: number; deviceScaleFactor?: number; pageScaleFactor?: number; offsetTop?: number; offsetLeft?: number };
};

/**
 * Starts a CDP screencast for a page. Returns a stop function. The consumer
 * receives base64 JPEG frames; consumers must not persist them.
 */
export async function startScreencast(page: Page, consumer: ScreencastConsumer): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  let stopped = false;
  cdp.on("event", (event) => {
    if (event.method !== "Page.screencastFrame") return;
    if (stopped) return;
    const payload = (event.params ?? {}) as ScreencastPayload;
    if (typeof payload.data !== "string") return;
    consumer({
      data: payload.data,
      sessionId: payload.sessionId ?? 0,
      width: payload.metadata?.width ?? 0,
      height: payload.metadata?.height ?? 0,
    });
    void cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId ?? 0 }).catch(() => undefined);
  });
  await cdp.send("Page.enable");
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
  return async () => {
    stopped = true;
    try {
      await cdp.send("Page.stopScreencast");
    } catch {
      // Already stopped.
    }
    await cdp.detach().catch(() => undefined);
  };
}

/** Captures a single ephemeral screenshot of the given page. */
export async function captureScreenshot(page: Page, format: "jpeg" | "png" = "jpeg"): Promise<{ dataUrl: string; bytes: number }> {
  const buffer = await page.screenshot({ type: format, quality: format === "png" ? undefined : 80 });
  return {
    dataUrl: `data:image/${format};base64,${buffer.toString("base64")}`,
    bytes: buffer.byteLength,
  };
}