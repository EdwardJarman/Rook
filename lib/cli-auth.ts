/**
 * Pure helpers for the CLI device-login flow (`rook login`).
 *
 * The CLI listens on 127.0.0.1:<port>/callback; the authed web app POSTs
 * `{ key, token, apiUrl }` there after the user approves. Key ties the
 * callback to the CLI session that opened the browser (CSRF). Everything
 * network-touching lives here so `app/cli-auth.tsx` stays a thin view —
 * and so the whole handshake is unit-testable without Expo.
 */

export type CliCallbackPayload = {
  key: string;
  token: string;
  apiUrl: string;
};

export const cliCallbackUrl = (port: number): string =>
  `http://127.0.0.1:${port}/callback`;

/** Parses the `?port=` query value. Null when missing or out of range. */
export const parseCallbackPort = (value: string | string[] | undefined | null): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,5}$/.test(raw.trim())) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
};

/** The terminal is gone (closed tab, timeout): retrying may still catch a slow starter. */
export class TerminalGoneError extends Error {}
/** The terminal answered but rejected the payload: mint a fresh code instead. */
export class TerminalRefusedError extends Error {}

/** POSTs the approved token to the waiting CLI. Throws honest errors. */
export async function postCliCallback(
  port: number,
  payload: CliCallbackPayload,
  timeoutMs = 8_000,
): Promise<void> {
  if (!payload.key || !payload.token) {
    throw new Error("Nothing to deliver: the approval came back empty.");
  }
  let response: Response;
  try {
    response = await fetch(cliCallbackUrl(port), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TerminalGoneError(
      "Rook CLI is not listening anymore. Keep the terminal open and try `rook login` again.",
    );
  }
  if (!response.ok) {
    throw new TerminalRefusedError(
      "Rook CLI refused the delivery. Re-run `rook login` for a fresh code and try again.",
    );
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True when something answers on the CLI callback port. Any HTTP status
 * counts (the listener 404s GETs) — only a refused connection means gone.
 * Lets the approval page say the terminal vanished BEFORE the user
 * approves into the void.
 */
export async function isTerminalAlive(port: number, timeoutMs = 3_000): Promise<boolean> {
  try {
    await fetch(cliCallbackUrl(port), {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delivers with retries across transient listener gaps (a terminal that
 * just started, a port in flux). Only network absence retries — refusals
 * and validation errors surface immediately.
 */
export async function deliverCliApproval(
  port: number,
  payload: CliCallbackPayload,
  opts?: {
    attempts?: number;
    delayMs?: number;
    post?: typeof postCliCallback;
  },
): Promise<void> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  const delayMs = opts?.delayMs ?? 2_000;
  const post = opts?.post ?? postCliCallback;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await post(port, payload);
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof TerminalGoneError) || attempt === attempts) throw error;
      await sleep(delayMs);
    }
  }
  throw lastError;
}
