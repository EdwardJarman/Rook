/**
 * Typed action executor.
 *
 * Maps the protocol's typed actions onto Playwright pages. The node keeps the
 * CDP/Playwright surface private; clients only ever see typed actions and
 * structured results.
 */
import type { Page } from "playwright";
import type { TypedAction } from "../types.js";

export type ActionResult =
  | { type: "goto"; url: string; title: string }
  | { type: "click" }
  | { type: "type" }
  | { type: "press" }
  | { type: "select" }
  | { type: "scroll" }
  | { type: "drag" }
  | { type: "hover" }
  | { type: "readUrl"; url: string }
  | { type: "readTitle"; title: string }
  | { type: "readText"; text: string }
  | { type: "readAttribute"; value: string | null }
  | { type: "screenshot"; dataUrl: string }
  | { type: "newTab" }
  | { type: "switchTab" }
  | { type: "closeTab" }
  | { type: "back"; url: string }
  | { type: "forward"; url: string }
  | { type: "reload"; url: string };

export class ActionError extends Error {
  constructor(
    public readonly code: "UNKNOWN_ACTION" | "NAV_BLOCKED" | "ELEMENT_MISSING" | "TIMEOUT",
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export interface NavigationGuard {
  (url: string): Promise<{ allowed: boolean; reason: string }> | { allowed: boolean; reason: string };
}

export async function executeAction(page: Page, action: TypedAction, guard: NavigationGuard): Promise<ActionResult> {
  switch (action.type) {
    case "goto": {
      const decision = await guard(action.url);
      if (!decision.allowed) throw new ActionError("NAV_BLOCKED", `Navigation blocked: ${decision.reason}`);
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      return { type: "goto", url: page.url(), title: await page.title() };
    }
    case "click":
      await page.locator(action.selector).first().click({ timeout: 15_000 });
      return { type: "click" };
    case "clickAt":
      await page.mouse.click(action.x, action.y);
      return { type: "click" };
    case "type": {
      const locator = page.locator(action.selector).first();
      await locator.click({ timeout: 15_000 });
      await locator.fill(action.text);
      return { type: "type" };
    }
    case "press":
      await page.keyboard.press(action.key);
      return { type: "press" };
    case "select":
      await page.locator(action.selector).first().selectOption(action.value);
      return { type: "select" };
    case "scrollTo":
      await page.evaluate(([x, y]) => window.scrollTo(x, y), [action.x, action.y] as const);
      return { type: "scroll" };
    case "scrollBy":
      await page.mouse.wheel(action.deltaX, action.deltaY);
      return { type: "scroll" };
    case "drag":
      await page.mouse.move(action.fromX, action.fromY);
      await page.mouse.down();
      await page.mouse.move(action.toX, action.toY, { steps: 8 });
      await page.mouse.up();
      return { type: "drag" };
    case "hover":
      await page.locator(action.selector).first().hover();
      return { type: "hover" };
    case "readUrl":
      return { type: "readUrl", url: page.url() };
    case "readTitle":
      return { type: "readTitle", title: await page.title() };
    case "readText": {
      const text = action.selector
        ? await page.locator(action.selector).first().innerText({ timeout: 10_000 })
        : await page.evaluate(() => (typeof document !== "undefined" ? document.body?.innerText ?? "" : ""));
      return { type: "readText", text };
    }
    case "readAttribute": {
      const value = await page.locator(action.selector).first().getAttribute(action.attribute, { timeout: 10_000 });
      return { type: "readAttribute", value };
    }
    case "screenshot": {
      const buffer = await page.screenshot({ type: action.format ?? "jpeg", quality: action.format === "png" ? undefined : 80 });
      return { type: "screenshot", dataUrl: `data:image/${action.format ?? "jpeg"};base64,${buffer.toString("base64")}` };
    }
    case "back":
      await page.goBack({ waitUntil: "domcontentloaded" });
      return { type: "back", url: page.url() };
    case "forward":
      await page.goForward({ waitUntil: "domcontentloaded" });
      return { type: "forward", url: page.url() };
    case "reload":
      await page.reload({ waitUntil: "domcontentloaded" });
      return { type: "reload", url: page.url() };
    case "newTab":
      return { type: "newTab" };
    case "switchTab":
      return { type: "switchTab" };
    case "closeTab":
      return { type: "closeTab" };
  }
}