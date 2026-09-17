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
    throw new Error(
      "Rook CLI is not listening anymore. Keep the terminal open and try `rook login` again.",
    );
  }
  if (!response.ok) {
    throw new Error(
      "Rook CLI refused the delivery. Re-run `rook login` for a fresh code and try again.",
    );
  }
}
