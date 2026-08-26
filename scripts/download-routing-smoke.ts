import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

function listen(app: express.Express): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not determine test server address");
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main(): Promise<void> {
  const assetHost = express();
  assetHost.head("/Rook.apk", (_request, response) => response.status(200).end());
  const asset = await listen(assetHost);
  process.env.ROOK_ANDROID_DOWNLOAD_URL = `${asset.origin}/Rook.apk`;

  const { pickNodeAssetForUserAgent, registerNodeDownloadRoutes } = await import("../server/download-routes.js");
  assert.equal(pickNodeAssetForUserAgent("Mozilla/5.0 (Linux; Android 15)"), "page");
  assert.equal(pickNodeAssetForUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");

  const app = express();
  registerNodeDownloadRoutes(app);
  const download = await listen(app);
  try {
    const android = await fetch(`${download.origin}/api/download/android`, { redirect: "manual" });
    assert.equal(android.status, 302);
    assert.equal(android.headers.get("location"), `${asset.origin}/Rook.apk`);

    const androidNode = await fetch(`${download.origin}/api/download/node`, {
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 15)" },
      redirect: "manual",
    });
    assert.equal(androidNode.status, 302);
    assert.equal(androidNode.headers.get("location"), "/download");
  } finally {
    await close(download.server);
    await close(asset.server);
  }

  console.log("Download routing smoke checks passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
