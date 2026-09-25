/**
 * Lifecycle hooks (Grok `xai-grok-hooks` port, narrowed to in-process).
 *
 * Five events: `SessionStart | PreToolUse | PostToolUse | Stop | UserSubmit`.
 * Semantics copied verbatim from the source system:
 * - exit-code-2 equivalent (`deny`) blocks; any other crash fails OPEN
 *   (recorded in trace notes, never blocks the action).
 * - `PreToolUse` may rewrite args (last rewrite wins, silently — the model
 *   is not told, matching grok's `updatedInput`).
 * - `PostToolUse` may replace output (redact secrets, trim walls of text —
 *   the sanctioned alternative to blind truncation). Last replacement wins;
 *   the record keeps the original.
 * - Hook executions surface as trace notes so the activity feed shows them.
 *
 * No handlers are registered by default: with an empty registry every runner
 * is a pass-through (zero behavior change).
 */

export type HookEvent =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "UserSubmit";

export type HookDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason: string }
  | { decision: "defer" };

export type PreToolUseInput = {
  event: "PreToolUse";
  toolName: string;
  args: Record<string, unknown>;
};

export type PreToolUseResult = {
  verdict: HookDecision;
  /** Merged rewrite (undefined when no handler rewrote). */
  updatedArgs?: Record<string, unknown>;
  /** Names of handlers that acted or failed (trace surfacing). */
  notes: string[];
};

export type PostToolUseInput = {
  event: "PostToolUse";
  toolName: string;
  output: string;
};

export type PostToolUseResult = {
  /** Model-facing output (replacement applied when a handler rewrote it). */
  output: string;
  /** Handler notes delivered alongside the result. */
  notes: string[];
};

type AnyHookInput =
  | PreToolUseInput
  | PostToolUseInput
  | { event: "SessionStart" | "Stop" | "UserSubmit" };

export type PreToolUseHandler = {
  name: string;
  run: (
    input: PreToolUseInput,
  ) => Promise<HookDecision & { updatedInput?: Record<string, unknown> }>;
};

export type PostToolUseHandler = {
  name: string;
  run: (
    input: PostToolUseInput,
  ) => Promise<{ decision?: "block"; reason?: string; updatedOutput?: string; note?: string }>;
};

const preToolUseHandlers: PreToolUseHandler[] = [];
const postToolUseHandlers: PostToolUseHandler[] = [];

export type LifecycleEvent = "SessionStart" | "Stop" | "UserSubmit";

export type LifecycleHandler = {
  name: string;
  run: (input: { event: LifecycleEvent }) => Promise<{ note?: string } | void> | { note?: string } | void;
};

const lifecycleHandlers: Record<LifecycleEvent, LifecycleHandler[]> = {
  SessionStart: [],
  Stop: [],
  UserSubmit: [],
};

/** Register an in-process handler. Returns an unregister function. */
export function registerHook(handler: PreToolUseHandler, event: "PreToolUse"): () => void;
export function registerHook(handler: PostToolUseHandler, event: "PostToolUse"): () => void;
export function registerHook(handler: LifecycleHandler, event: LifecycleEvent): () => void;
export function registerHook(
  handler: PreToolUseHandler | PostToolUseHandler | LifecycleHandler,
  event: HookEvent,
): () => void {
  const list =
    event === "PreToolUse"
      ? preToolUseHandlers
      : event === "PostToolUse"
        ? postToolUseHandlers
        : lifecycleHandlers[event];
  (list as unknown[]).push(handler);
  return () => {
    const index = (list as unknown[]).indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
}

/** Test-only reset (mirrors `__resetSkillsForTests`). */
export const __resetHooksForTests = (): void => {
  preToolUseHandlers.length = 0;
  postToolUseHandlers.length = 0;
  lifecycleHandlers.SessionStart.length = 0;
  lifecycleHandlers.Stop.length = 0;
  lifecycleHandlers.UserSubmit.length = 0;
};

/** Passive lifecycle events: every handler runs, notes accumulate, nothing blocks. */
export async function runLifecycleHook(event: LifecycleEvent): Promise<string[]> {
  const notes: string[] = [];
  for (const handler of [...lifecycleHandlers[event]]) {
    try {
      const outcome = await handler.run({ event });
      if (outcome && typeof outcome.note === "string" && outcome.note) {
        notes.push(`hook ${handler.name}: ${outcome.note}`);
      }
    } catch (error) {
      notes.push(
        `hook ${handler.name} failed open (${error instanceof Error ? error.message : "crash"})`,
      );
    }
  }
  return notes;
}

/**
 * Run the `PreToolUse` chain. First `deny` wins and stops the chain;
 * rewrites merge in order (last wins); crashes fail open with a note.
 */
export async function runPreToolUse(input: PreToolUseInput): Promise<PreToolUseResult> {
  const notes: string[] = [];
  let updatedArgs: Record<string, unknown> | undefined;
  for (const handler of [...preToolUseHandlers]) {
    try {
      const outcome = await handler.run(input);
      if (outcome && typeof outcome === "object" && "decision" in outcome) {
        const decision = (outcome as HookDecision).decision;
        if (decision === "deny") {
          // A deny discards every rewrite (grok semantics): the call never runs.
          return {
            verdict: outcome as HookDecision,
            updatedArgs: undefined,
            notes: [...notes, `hook ${handler.name} denied ${input.toolName}`],
          };
        }
      }
      const rewrite = (outcome as { updatedInput?: Record<string, unknown> })?.updatedInput;
      if (rewrite && typeof rewrite === "object") {
        updatedArgs = { ...(updatedArgs ?? input.args), ...rewrite };
        notes.push(`hook ${handler.name} rewrote ${input.toolName} args`);
      }
    } catch (error) {
      notes.push(
        `hook ${handler.name} failed open (${error instanceof Error ? error.message : "crash"})`,
      );
    }
  }
  return { verdict: { decision: "allow" }, updatedArgs, notes };
}

/**
 * Run the `PostToolUse` chain. Nothing blocks (the tool already ran);
 * every handler runs, notes accumulate in order, last replacement wins.
 * Crashes keep the original output with a note.
 */
export async function runPostToolUse(input: PostToolUseInput): Promise<PostToolUseResult> {
  const notes: string[] = [];
  let output = input.output;
  for (const handler of [...postToolUseHandlers]) {
    try {
      const outcome = await handler.run(input);
      if (outcome?.note) notes.push(`hook ${handler.name}: ${outcome.note}`);
      if (outcome?.decision === "block" && outcome?.reason) {
        notes.push(`hook ${handler.name} flagged: ${outcome.reason}`);
      }
      if (typeof outcome?.updatedOutput === "string") {
        output = outcome.updatedOutput;
        notes.push(`hook ${handler.name} replaced ${input.toolName} output`);
      }
    } catch (error) {
      notes.push(
        `hook ${handler.name} failed open (${error instanceof Error ? error.message : "crash"})`,
      );
    }
  }
  return { output, notes };
}
