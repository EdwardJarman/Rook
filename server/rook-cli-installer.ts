export const CLI_RELEASES_DOWNLOAD_BASE =
  "https://github.com/EdwardJarman/Rook/releases/latest/download";

export const CLI_ASSETS = {
  windows: "Rook-CLI-windows-x64.zip",
  macArm64: "Rook-CLI-macos-arm64.tar.gz",
  macIntel: "Rook-CLI-macos-x64.tar.gz",
  linux: "Rook-CLI-linux-x64.tar.gz",
} as const;

export type CliTarget = keyof typeof CLI_ASSETS;

export function isCliTarget(value: unknown): value is CliTarget {
  return typeof value === "string" && value in CLI_ASSETS;
}

export function pickCliAssetForUserAgent(
  ua: string | undefined,
): CliTarget | "page" {
  const agent = ua ?? "";
  if (/Windows NT/i.test(agent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(agent)) return "macArm64";
  if (/Linux/i.test(agent) && !/Android/i.test(agent)) return "linux";
  return "page";
}

/**
 * POSIX installer: builds the real Rook CLI from source (sparse checkout
 * of cli/ + npm ci + build) and drops one `rook` executable into
 * ~/.local/bin. Uses only sh/git/node/npm/mv/chmod — never sudo, never
 * eval, user folder only. The same flow is verified end to end by
 * cli/install.sh, which shares this logic for repo-local installs.
 */
export function buildPosixCliInstaller(origin: string): string {
  const page = origin.replace(/\/$/, "");
  return `#!/usr/bin/env sh
# Rook CLI installer. Usage: curl -fsSL ${page}/api/download/cli/install.sh | sh
set -eu

REPO="https://github.com/EdwardJarman/Rook.git"
REF="\${ROOK_REF:-main}"
BIN_DIR="\${ROOK_BIN_DIR:-\$HOME/.local/bin}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "rook install: missing '$1' - please install it first." >&2; exit 1; }
}
need git
need node
need npm
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" || {
  echo "rook install: node >= 20 required." >&2
  exit 1
}

WORK=""
cleanup() {
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT HUP INT TERM

if [ -f "./cli/package.json" ] && [ -d "./cli/src" ]; then
  SRC="./cli"
else
  WORK="$(mktemp -d "\${TMPDIR:-/tmp}/rook-cli.XXXXXX")/rook-cli-install"
  echo "rook install: fetching installer sources..."
  git clone --quiet --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$WORK"
  git -C "$WORK" sparse-checkout set cli
  SRC="$WORK/cli"
fi

if [ ! -f "$SRC/package.json" ]; then
  echo "rook install: Rook CLI sources not found (branch $REF has no cli/ yet)." >&2
  echo "Push the Rook repo first, or run this script from a Rook checkout." >&2
  exit 1
fi

echo "rook install: building..."
npm --prefix "$SRC" ci --no-audit --no-fund || npm --prefix "$SRC" install --no-audit --no-fund
npm --prefix "$SRC" run build

mkdir -p "$BIN_DIR"
cp "$SRC/dist/rook.cjs" "$BIN_DIR/rook"
chmod +x "$BIN_DIR/rook"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '%s\\n' "Add this to your shell profile, then open a new terminal:"
    printf '  export PATH="%s:$PATH"\\n' "$BIN_DIR"
    ;;
esac

if "$BIN_DIR/rook" version >/dev/null 2>&1; then
  printf '%s\\n' "rook install: done - rook $($BIN_DIR/rook version) at $BIN_DIR/rook"
  printf '%s\\n' "Next: rook login (or download Rook Node instead: ${page}/download)"
else
  echo "rook install: build ok, but $BIN_DIR/rook did not run - check node is on your PATH." >&2
  exit 1
fi
`;
}

/**
 * PowerShell installer: same source-install flow for Windows. Strictly
 * ASCII (Windows PowerShell 5.1 misdecodes UTF-8 without BOM), no
 * elevation, no Start-Process/RunAs, user folder only.
 */
export function buildPowerShellCliInstaller(origin: string): string {
  const page = origin.replace(/\/$/, "");
  return `$ErrorActionPreference = "Stop"
# Rook CLI installer. Usage: irm ${page}/api/download/cli/install.ps1 | iex
$Repo = "https://github.com/EdwardJarman/Rook.git"
$Ref = if ($env:ROOK_REF) { $env:ROOK_REF } else { "main" }
$BinDir = if ($env:ROOK_BIN_DIR) { $env:ROOK_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Rook\\bin" }

function Need($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "rook install: missing '$Name' - please install it first."
  }
}

Need "git"
Need "node"
Need "npm"
$Major = (& node -e "console.log(process.versions.node.split('.')[0])").Trim()
if ([int]$Major -lt 20) { Write-Error "rook install: node >= 20 required." }

$Work = ""
try {
  if ((Test-Path "./cli/package.json") -and (Test-Path "./cli/src")) {
    $Src = "./cli"
  } else {
    $Work = Join-Path ([System.IO.Path]::GetTempPath()) ("rook-cli-install-" + [System.Guid]::NewGuid().ToString("N"))
    Write-Host "rook install: fetching installer sources..."
    & git clone --quiet --depth 1 --branch $Ref --filter=blob:none --sparse $Repo $Work
    if ($LASTEXITCODE -ne 0) { Write-Error "rook install: git clone failed." }
    & git -C $Work sparse-checkout set cli
    $Src = Join-Path $Work "cli"
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Src "package.json"))) {
    Write-Error "rook install: Rook CLI sources not found (branch $Ref has no cli/ yet). Push the Rook repo first, or run this script from a Rook checkout."
  }

  Write-Host "rook install: building..."
  & npm --prefix $Src ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { & npm --prefix $Src install --no-audit --no-fund }
  if ($LASTEXITCODE -ne 0) { Write-Error "rook install: dependency install failed." }
  & npm --prefix $Src run build
  if ($LASTEXITCODE -ne 0) { Write-Error "rook install: build failed." }

  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Copy-Item (Join-Path $Src "dist/rook.cjs") (Join-Path $BinDir "rook.cjs") -Force
  Set-Content -Path (Join-Path $BinDir "rook.cmd") -Value '@node "%~dp0rook.cjs" %*' -NoNewline

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    Write-Host "rook install: added $BinDir to your user PATH (new terminals pick it up)."
  }
  # irm | iex runs inside the caller's session: update this shell too so
  # rook works immediately without opening a new terminal.
  if ($env:Path -notlike "*$BinDir*") {
    $env:Path = "$env:Path;$BinDir"
    Write-Host "rook install: this window is ready too - run rook login."
  }

  $Version = ((& (Join-Path $BinDir "rook.cmd") version 2>$null) | Out-String).Trim() -replace '\x1b\[[0-9;]*m', ''
  if ($LASTEXITCODE -eq 0 -and $Version) {
    Write-Host "rook install: done - rook $Version at $BinDir\\rook.cmd"
    Write-Host "Next: rook login (or download Rook Node instead: ${page}/download)"
  } else {
    Write-Error "rook install: build ok, but rook did not run - check node is on your PATH."
  }
} finally {
  if ($Work -and (Test-Path $Work)) { Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
`;
}
