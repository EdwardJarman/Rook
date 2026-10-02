/**
 * Static CLI device-approval page (`GET /api/cli-auth?code=XXXX-XXXX`).
 *
 * Why this exists: the React approval screen (`app/cli-auth.tsx`) is part of
 * the full Expo bundle - the browser downloads and hydrates the entire app
 * (Clerk SDK, the app router, RN Web, shaders) before a tiny approve button
 * renders. On the deployed site that is seconds of white screen. This route
 * serves a self-contained HTML document (inline CSS + one script tag for
 * Clerk.js) that paints in well under a second and talks to the same tRPC
 * backend.
 *
 * Auth: same-origin fetches carry no Clerk cookie (dev-instance cookies live
 * on *.clerk.accounts.dev), so the page loads Clerk.js with the build-time
 * publishable key and sends a session JWT as a Bearer token. Clerk.js is the
 * only external resource; without it the page still shows the code.
 */

import type { Express, Request, Response } from "express";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function publishableKey(): string {
  return (
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    process.env.CLERK_PUBLISHABLE_KEY ??
    // Same checked-in dev fallback the app bundle uses (scripts/vercel-build.mjs).
    "pk_test_aW5zcGlyZWQtaG9uZXliZWUtNDMuY2xlcmsuYWNjb3VudHMuZGV2JA"
  );
}

function pageHtml(code: string): string {
  const safeCode = escapeHtml(code);
  const pk = publishableKey();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Connect device - Rook</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #faf9f4; color: #23211c;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    width: 100%; max-width: 440px; background: #fff; border: 1px solid #e6e4da;
    border-radius: 20px; padding: 32px 28px; box-shadow: 0 10px 24px rgba(35,33,28,.05);
    text-align: center; display: flex; flex-direction: column; gap: 16px; align-items: center;
  }
  .mark { width: 40px; height: 40px; border-radius: 12px; background: #23211c; color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; }
  h1 { font-size: 21px; font-weight: 700; }
  p { font-size: 13.5px; line-height: 1.5; color: #5c5849; }
  .code { font-family: ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
    font-size: 26px; font-weight: 800; letter-spacing: 3px; }
  .btn { appearance: none; border: 0; cursor: pointer; min-height: 46px; border-radius: 15px;
    padding: 0 22px; font-size: 14px; font-weight: 700; background: #23211c; color: #faf9f4; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.secondary { background: #f1efe6; color: #5c5849; }
  .ok { color: #177149; font-weight: 600; font-size: 14px; }
  .err { color: #c2452d; font-size: 13px; }
  .hidden { display: none; }
  #clerk-mount { width: 100%; }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">R</div>
    <h1>Connect this device?</h1>
    <p>Your terminal asked to sign in with your Rook account. Check the code matches, then approve - your terminal signs itself in.</p>
    <div class="code">${safeCode}</div>
    <button id="copy" class="btn secondary" type="button">Copy code</button>
    <div id="clerk-mount" class="hidden"></div>
    <button id="approve" class="btn" type="button" disabled>Approve this device</button>
    <p id="status"></p>
    <p id="hint" class="hidden">Not signed in? <a href="/sign-in">Sign in</a>, then reopen this page.</p>
  </main>
  <script async crossorigin="anonymous"
    src="https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6/dist/clerk.browser.js"
    data-clerk-publishable-key="${escapeHtml(pk)}"></script>
  <script>
  (function () {
    var code = ${JSON.stringify(code)};
    var approve = document.getElementById("approve");
    var status = document.getElementById("status");
    var hint = document.getElementById("hint");
    var copyBtn = document.getElementById("copy");
    var mount = document.getElementById("clerk-mount");

    function say(msg, cls) { status.textContent = msg; status.className = cls || ""; }
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(code).then(function () {
        copyBtn.textContent = "Copied";
        setTimeout(function () { copyBtn.textContent = "Copy code"; }, 1800);
      });
    });

    async function approveDevice() {
      approve.disabled = true;
      say("Approving...");
      try {
        var token = await window.Clerk.session.getToken();
        var res = await fetch("/api/trpc/auth.deviceApprove?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ "0": { json: { code: code, label: "CLI (web)" } } }),
        });
        var body = await res.json();
        if (!res.ok || (body[0] && body[0].error)) {
          var msg = (body[0] && body[0].error && body[0].error.message) || ("HTTP " + res.status);
          throw new Error(msg);
        }
        approve.className = "hidden";
        copyBtn.className = "hidden";
        say("Device connected - return to your terminal.", "ok");
      } catch (e) {
        approve.disabled = false;
        say(e && e.message ? e.message : "Approval failed. Re-run rook login for a fresh code.", "err");
      }
    }
    approve.addEventListener("click", approveDevice);

    async function boot() {
      if (!window.Clerk) { say("Could not load sign-in. Refresh, or approve from the app.", "err"); return; }
      await window.Clerk.load();
      if (window.Clerk.session) {
        approve.disabled = false;
        say("Signed in - approve when ready.");
      } else {
        say("You need to sign in to approve this device.");
        hint.className = "";
        mount.className = "";
        window.Clerk.mountSignIn(mount, { routing: "virtual", signUpUrl: "/sign-up" });
      }
    }
    if (document.readyState === "complete") boot();
    else window.addEventListener("load", boot);
  })();
  </script>
</body>
</html>`;
}

export function registerCliAuthRoute(app: Express): void {
  app.get("/api/cli-auth", (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    if (!code) {
      res
        .status(400)
        .type("text/html; charset=utf-8")
        .send(
          "<!doctype html><meta charset=utf-8><title>Rook CLI auth</title><p>This page pairs a terminal running <code>rook login</code>. Start there first - it opens this page for you.</p>",
        );
      return;
    }
    res
      .status(200)
      .set("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .send(pageHtml(code));
  });
}

