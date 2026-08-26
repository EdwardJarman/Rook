/**
 * Rook Node download endpoints.
 *
 *   GET /api/download/node        → 302 to the right desktop installer for the caller's OS
 *   GET /api/download/android     → 302 to the published Android application build
 *   GET /api/download/node/latest → JSON manifest (feeds the future auto-updater)
 *
 * Assets live on GitHub Releases under FIXED names (Rook-Node-Setup.exe,
 * Rook-Node-arm64.dmg, …) uploaded by the release workflow. GitHub's
 * `releases/latest/download/<asset>` URL always resolves to the newest
 * published release, so this route is a thin, cache-friendly redirect and
 * users never see GitHub.
 */

const RELEASES_DOWNLOAD_BASE = "https://github.com/EdwardJarman/Rook/releases/latest/download";
const RELEASES_API_LATEST = "https://api.github.com/repos/EdwardJarman/Rook/releases/latest";
const DOWNLOAD_PAGE = "/download";
// Set ROOK_ANDROID_DOWNLOAD_URL to the production Play Store, EAS, or signed
// APK URL. The stable GitHub asset remains a sensible release-pipeline default.
const ANDROID_DOWNLOAD_URL = process.env.ROOK_ANDROID_DOWNLOAD_URL?.trim() || `${RELEASES_DOWNLOAD_BASE}/Rook.apk`;

export const NODE_ASSETS = {
  windows: "Rook-Node-Setup.exe",
  macArm64: "Rook-Node-arm64.dmg",
  macIntel: "Rook-Node-intel.dmg",
  linux: "Rook-Node-x86_64.AppImage",
} as const;

export type NodeAssetTarget = keyof typeof NODE_ASSETS;

/**
 * Picks the installer for a browser user agent. Apple-Silicon Macs report
 * "Intel" in their UA for compatibility, so macOS defaults to arm64; Intel
 * users pick the other one from the download page.
 */
export function pickNodeAssetForUserAgent(ua: string | undefined): NodeAssetTarget | "page" {
  const agent = ua ?? "";
  if (/Windows NT/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "macArm64";
  if (/Linux/i.test(agent) && !/Android/i.test(agent)) return "linux";
  return "page"; // phones, tablets, unknown clients
}

export function registerNodeDownloadRoutes(app: import("express").Express): void {
  app.get("/api/download/node", (req, res) => {
    void serveDownload(req, res);
  });

  app.get("/api/download/node/latest", (_req, res) => {
    void serveLatestManifest(res);
  });

  app.get("/api/download/android", (_req, res) => {
    void serveAndroidDownload(res);
  });
}

/**
 * Redirects to the platform installer. If the asset isn't published yet
 * (mid-release window), sends the user to the download page with a pending
 * hint instead of a GitHub 404.
 */
async function serveDownload(req: import("express").Request, res: import("express").Response): Promise<void> {
  const picked = pickNodeAssetForUserAgent(req.headers["user-agent"]);
  if (picked === "page") {
    res.redirect(302, DOWNLOAD_PAGE);
    return;
  }
  const assetUrl = `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS[picked]}`;
  try {
    const head = await fetch(assetUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (!head.ok) {
      res.redirect(302, `${DOWNLOAD_PAGE}?pending=${picked}`);
      return;
    }
  } catch {
    // GitHub unreachable from the server: send the user through anyway —
    // their browser may reach it fine.
  }
  res.redirect(302, assetUrl);
}

async function serveAndroidDownload(res: import("express").Response): Promise<void> {
  try {
    const head = await fetch(ANDROID_DOWNLOAD_URL, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    if (!head.ok) {
      res.redirect(302, `${DOWNLOAD_PAGE}?pending=android`);
      return;
    }
  } catch {
    // If the configured host is temporarily unavailable, let the caller try
    // the direct Android URL rather than presenting an unrelated desktop build.
  }
  res.redirect(302, ANDROID_DOWNLOAD_URL);
}

let manifestCache: { body: unknown; expiresAt: number } | null = null;

async function serveLatestManifest(res: import("express").Response): Promise<void> {
  if (manifestCache && manifestCache.expiresAt > Date.now()) {
    res.json(manifestCache.body);
    return;
  }
  try {
    const response = await fetch(RELEASES_API_LATEST, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rook-Node-Download" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const body = (await response.json()) as { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string }> };
    const manifest = {
      version: typeof body.tag_name === "string" ? body.tag_name : null,
      urls: {
        windows: `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS.windows}`,
        macArm64: `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS.macArm64}`,
        macIntel: `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS.macIntel}`,
        linux: `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS.linux}`,
      },
    };
    manifestCache = { body: manifest, expiresAt: Date.now() + 5 * 60_000 };
    res.json(manifest);
  } catch {
    // Never fail hard on updater metadata; serve a minimal offline shape.
    res.json({ version: null, urls: {} });
  }
}
