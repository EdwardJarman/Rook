/**
 * RookNode core: the local execution authority.
 *
 * Owns the SQLite database, Bot registry, lease manager, approval manager,
 * file broker, and Chromium runtime. Receives validated command envelopes and
 * produces command results. Never exposes the CDP/Playwright surface directly.
 */
import type { Page } from "playwright";

import type { RookConfig } from "../config.js";
import { newId } from "../config.js";
import { RookDatabase } from "../state/database.js";
import { BotRegistry } from "../registry/bot-registry.js";
import { LeaseManager } from "../control/lease.js";
import { ApprovalManager } from "../control/approvals.js";
import { FileBroker } from "../files/broker.js";
import { ChromiumRuntime } from "../runtime/chromium.js";
import { executeAction } from "../control/executor.js";
import { CommandValidator, type DeviceBinding } from "../control/protocol.js";
import { evaluateUrlWithDns } from "../security/network-policy.js";
import type { Capability, CommandEnvelope, CommandRejectCode, CommandResult, LeaseRecord, NodeHealth, TabRecord, TypedAction } from "../types.js";
import { allowsCapability, SENSITIVE_CAPABILITIES } from "../types.js";

export class RookNode {
  readonly db: RookDatabase;
  readonly registry: BotRegistry;
  readonly leases: LeaseManager;
  readonly approvals: ApprovalManager;
  readonly files: FileBroker;
  readonly runtime: ChromiumRuntime;
  private readonly validator: CommandValidator;
  private readonly bindings = new Map<string, DeviceBinding>();
  /** In-memory pageId → live Page map; rebuilt lazily after browser restarts. */
  private readonly pages = new Map<string, Page>();

  constructor(readonly config: RookConfig, options: { headless?: boolean; channel?: string } = {}) {
    this.db = new RookDatabase(config);
    this.registry = new BotRegistry(this.db);
    this.leases = new LeaseManager(this.db);
    this.approvals = new ApprovalManager(this.db);
    this.files = new FileBroker(config, this.db);
    this.runtime = new ChromiumRuntime(config, this.db, options);
    this.validator = new CommandValidator({
      db: this.db,
      bindingForDevice: (deviceId) => this.bindings.get(deviceId),
      tabRevision: (pageId) => this.registry.tabRevision(pageId),
      validateApproval: (proof, action, capability) => this.approvals.validateProof(proof, action, capability),
    });
  }

  async start(): Promise<void> {
    if (this.config.noLaunch) return;
    await this.runtime.start();
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

  close(): void {
    this.db.close();
  }

  /* ---- device bindings ---- */

  setDeviceBinding(binding: DeviceBinding): void {
    this.bindings.set(binding.deviceId, binding);
  }

  removeDeviceBinding(deviceId: string): void {
    this.bindings.delete(deviceId);
  }

  /* ---- command pipeline ---- */

  async dispatch(raw: unknown): Promise<CommandResult> {
    const verdict = this.validator.validate(raw);
    if (!verdict.ok) return verdict;
    const command = verdict.command;

    const required = command.capability;
    const mutating = SENSITIVE_CAPABILITIES.has(required) || command.action.type === "goto" || command.action.type === "newTab";
    if (mutating) {
      try {
        this.leases.assertBotMutationAllowed(command.botId, this.leases.get(command.botId).fencing);
      } catch (error) {
        return { ok: false, code: "LEASE", message: (error as Error).message };
      }
    } else {
      try {
        this.leases.assertViewAllowed(command.botId);
      } catch (error) {
        return { ok: false, code: "LEASE", message: (error as Error).message };
      }
    }

    try {
      const result = await this.runAction(command);
      return { ok: true, value: result };
    } catch (error) {
      return { ok: false, code: this.errorCode(error), message: (error as Error).message };
    }
  }

  private async runAction(command: CommandEnvelope): Promise<unknown> {
    const needsApproval = SENSITIVE_CAPABILITIES.has(command.capability);

    // Tab lifecycle actions mutate the registry, not a single page.
    if (command.action.type === "newTab") return this.openTabForCommand(command);
    if (command.action.type === "closeTab") return this.closeTabForCommand(command);
    if (command.action.type === "switchTab") {
      const page = await this.pageFor(command.botId, command.action.pageId);
      if (!page) return { type: "unknownPage" };
      await page.bringToFront().catch(() => undefined);
      return { type: "switchTab" };
    }

    const page = await this.pageFor(command.botId, command.pageId);
    if (!page) return { type: "unknownPage" };

    const result = await executeAction(page, command.action, async (url) => {
      const decision = await evaluateUrlWithDns(url);
      if (!decision.allowed) return { allowed: false, reason: decision.reason };
      return { allowed: true, reason: "public" };
    });

    if (needsApproval && command.approval) this.approvals.consumeNonce(command.approval);

    if (result && "url" in result && typeof result.url === "string") {
      this.registry.recordNavigation(command.pageId, result.url);
      await page.title().then((title) => this.registry.updateTabTitle(command.pageId, title)).catch(() => undefined);
    }
    this.runtime.checkpoint(this.db);
    return result;
  }

  /** Creates a live tab + registry entry for the Bot. The action's url is optional. */
  private async openTabForCommand(command: CommandEnvelope): Promise<unknown> {
    const context = this.runtime.getContext();
    if (!context) return { type: "browserNotRunning" };
    const action = command.action as { type: "newTab"; url: string };
    let tab;
    try {
      tab = this.registry.openTab(command.botId, action.url || "about:blank");
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "LEASE" });
    }
    const page = await context.newPage();
    this.pages.set(tab.id, page);
    if (action.url && action.url !== "about:blank") {
      const decision = await evaluateUrlWithDns(action.url);
      if (!decision.allowed) {
        await page.close().catch(() => undefined);
        this.pages.delete(tab.id);
        this.registry.closeTab(tab.id);
        throw Object.assign(new Error(`Navigation blocked: ${decision.reason}`), { code: "NAV_BLOCKED" });
      }
      try {
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.title().then((title) => this.registry.updateTabTitle(tab.id, title)).catch(() => undefined);
        this.registry.recordNavigation(tab.id, page.url());
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "TIMEOUT" });
      }
    } else {
      this.registry.recordNavigation(tab.id, "about:blank");
    }
    this.runtime.checkpoint(this.db);
    return { type: "newTab", pageId: tab.id, url: tab.url };
  }

  private async closeTabForCommand(command: CommandEnvelope): Promise<unknown> {
    const action = command.action as { type: "closeTab"; pageId?: string };
    const targetId = action.pageId ?? command.pageId;
    const page = this.pages.get(targetId);
    if (page) {
      await page.close().catch(() => undefined);
      this.pages.delete(targetId);
    }
    if (this.registry.tabRevision(targetId) !== undefined) this.registry.closeTab(targetId);
    this.runtime.checkpoint(this.db);
    return { type: "closeTab", closedPageId: targetId };
  }

  private async pageFor(botId: string, pageId: string): Promise<Page | null> {
    const mapped = this.pages.get(pageId);
    if (mapped && !mapped.isClosed()) return mapped;

    // Re-adopt after restart: match by URL recorded in the registry.
    const context = this.runtime.getContext();
    if (!context) return null;
    const tab = this.registry.tabsForBot(botId).find((entry) => entry.id === pageId);
    const candidate =
      (tab ? context.pages().find((page) => page.url() === tab.url && !page.isClosed()) : undefined) ??
      context.pages().find((page) => page.url() !== "about:blank" && !page.isClosed()) ??
      context.pages().find((page) => !page.isClosed());
    if (candidate) this.pages.set(pageId, candidate);
    return candidate ?? null;
  }

  /** Registers a cloud-issued approval grant as a local approved record. */
  ingestCloudApproval(input: {
    botId: string;
    pageId: string;
    action: TypedAction;
    capability: Capability;
    origin: string;
    summary: string;
    grant: { approvalId: string; nonce: string; expiresAt: number; pageRevision: number };
  }): void {
    this.approvals.ingestCloudApproval(input);
  }

  private errorCode(error: unknown): CommandRejectCode {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (code === "NAV_BLOCKED" || code === "ELEMENT_MISSING" || code === "TIMEOUT" || code === "UNKNOWN_ACTION") {
      return code as CommandRejectCode;
    }
    return "INVALID";
  }

  /* ---- approvals ---- */

  requestApproval(input: { botId: string; pageId: string; action: TypedAction; capability: Capability; origin: string; summary: string; pageRevision: number }) {
    return this.approvals.request({ ...input, pageRevision: input.pageRevision });
  }

  resolveApproval(id: string, decision: "approved" | "declined") {
    return this.approvals.resolve(id, { state: decision });
  }

  pendingApprovals() {
    return this.approvals.list(undefined, "pending");
  }

  /* ---- health ---- */

  health(): NodeHealth {
    return {
      running: this.runtime.isRunning(),
      browserPid: this.runtime.browserPid(),
      profileReady: this.runtime.isRunning(),
      bots: this.registry.listBots().length,
      tabs: this.registry.allTabs().length,
      pendingApprovals: this.pendingApprovals().length,
      leases: Object.fromEntries(this.leases.all().map((lease) => [lease.botId, lease])),
      version: "0.1.0",
      startedAt: this.runtime.startedAt,
    };
  }

  /* ---- events ---- */

  recordEvent(botId: string, kind: string, payload: unknown): void {
    this.db.appendEvent({
      id: newId("event"),
      botId,
      kind,
      payload: JSON.stringify(payload),
      createdAt: new Date().toISOString(),
    });
  }
}

export type { ActionResult } from "../control/executor.js";
export type { TabRecord };
export type { LeaseRecord };