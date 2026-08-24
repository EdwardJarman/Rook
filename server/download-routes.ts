/**
 * Rook Node download endpoints.
 *
 *   GET /api/download/node        → 302 to the right installer for the caller's OS
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
    const picked = pickNodeAssetForUserAgent(req.headers["user-agent"]);
    if (picked === "page") {
      res.redirect(302, DOWNLOAD_PAGE);
      return;
    }
    res.redirect(302, `${RELEASES_DOWNLOAD_BASE}/${NODE_ASSETS[picked]}`);
  });

  app.get("/api/download/node/latest", (_req, res) => {
    void serveLatestManifest(res);
  });
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
