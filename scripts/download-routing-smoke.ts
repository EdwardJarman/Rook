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
  const mode = process.env.DOWNLOAD_ROUTING_MODE ?? "available";
  const assetHost = express();
  assetHost.head("/Rook.apk", (_request, response) => response.status(200).end());
  const asset = await listen(assetHost);
  process.env.ROOK_ANDROID_DOWNLOAD_URL = mode === "available"
    ? `${asset.origin}/Rook.apk`
    : `${asset.origin}/not-published.apk`;

  const { pickNodeAssetForUserAgent, registerNodeDownloadRoutes } = await import("../server/download-routes.js");
  assert.equal(pickNodeAssetForUserAgent("Mozilla/5.0 (Linux; Android 15)"), "page");
  assert.equal(pickNodeAssetForUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");

  const app = express();
  registerNodeDownloadRoutes(app);
  const download = await listen(app);
  try {
    const android = await fetch(`${download.origin}/api/download/android`, { redirect: "manual" });
    if (mode === "available") {
      assert.equal(android.status, 302);
      assert.equal(android.headers.get("location"), `${asset.origin}/Rook.apk`);

      const androidJson = await fetch(`${download.origin}/api/download/android?format=json`);
      assert.equal(androidJson.status, 200);
      assert.deepEqual(await androidJson.json(), { available: true, url: `${asset.origin}/Rook.apk` });
    } else {
      assert.equal(android.status, 503);
      assert.deepEqual(await android.json(), {
        available: false,
        message: "The Rook Android app is not published yet. Please try again shortly.",
      });
    }

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

  console.log(`Download routing smoke checks passed (${mode}).`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
