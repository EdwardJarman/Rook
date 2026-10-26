# Rook v0.2.1 — Release Runbook (what's left for a token holder)

Everything below this line was already verified locally on 2026-09-04:
the Windows installer pipeline builds a WORKING app (installed, launched,
gateway healthy, window paints — see PROGRESS.md). What remains is
publishing, which needs GitHub credentials that aren't available to the
automation.

## 1. Push the code and the tag (this triggers the release build)

```bash
cd "C:\Users\marti\OneDrive\Desktop\Eddie\Rook-"
git push origin main
git tag v0.2.1
git push origin v0.2.1
```

The `v0.2.1` tag triggers `.github/workflows/release-rook-node.yml`, which
builds Windows + macOS (arm64/intel) + Linux installers and the CLI
archives, verifies each staged asset (`verify-release-assets.mjs`), and
publishes the release with `make_latest: true`. The workflow reads
`secrets.VITE_CLERK_PUBLISHABLE_KEY` — **check it is set** under
Settings → Secrets → Actions before pushing, otherwise the app ships in
the degraded (no sign-in) mode. `VITE_API_BASE_URL` is optional.

## 2. Watch the run

https://github.com/EdwardJarman/Rook/actions — the "Release Rook Node"
workflow takes ~25–40 min per platform (Chromium download is the long
pole). All four must go green; the "Install test (Windows sandbox)" job
silently installs the produced NSIS installer on a clean runner and hits
the gateway — if that fails, do not publish.

## 3. Verify the public download page

- `curl -sIL https://github.com/EdwardJarman/Rook/releases/latest/download/Rook-Node-Setup.exe` → 302 to the v0.2.1 asset
- Open https://www.rook.lighting/download — cards should show `v0.2.1` and
  the Android card should say COMING SOON (Rook.apk is only built by the
  separate APK workflow; run it if a fresh APK is wanted).

## 4. If CI still fails on macOS/Linux

The Windows asset from a local build can be attached manually (CI's build
is preferred because it embeds the Clerk key):

```bash
GH_TOKEN=ghp_xxx  # needs `repo` scope / fine-grained: contents:write
node scripts/verify-release-assets.mjs <dir-with-assets> Rook-Node-Setup.exe,Rook-CLI-windows-x64.zip
curl -L -X POST -H "Authorization: Bearer $GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"rook-node/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Rook_0.2.1_x64-setup.exe" \
  "https://uploads.github.com/repos/EdwardJarman/Rook/releases/<release-id>/assets?name=Rook-Node-Setup.exe"
```

## Why v0.2.1 and not v0.2.0

The `v0.2.0` tag already exists on the remote (30617ca) but its release
never published (CI failures; the handoff's "v0.2.0 release" is a draft at
best). Never move a pushed tag: the fixes are on main now, so v0.2.1 is
the first *shippable* tag. Until v0.2.1 publishes, the public download
page serves v0.1.20 (the old console app).
