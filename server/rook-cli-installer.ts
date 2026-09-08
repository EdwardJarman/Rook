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
 * A POSIX installer deliberately uses only curl, tar, chmod, and mv, which are
 * present on supported macOS and Linux systems. It never invokes sudo and
 * installs beneath the current user's home directory.
 */
export function buildPosixCliInstaller(origin: string): string {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="${origin.replace(/\/$/, "")}" 
INSTALL_DIR="${"$"}{ROOK_INSTALL_DIR:-${"$"}HOME/.local/bin}"
TEMP_DIR="$(mktemp -d "${"$"}{TMPDIR:-/tmp}/rook-cli.XXXXXX")"
cleanup() { rm -rf "${"$"}TEMP_DIR"; }
trap cleanup EXIT HUP INT TERM

need() {
  command -v "${"$"}1" >/dev/null 2>&1 || { echo "Rook installer needs ${"$"}1, but it was not found." >&2; exit 1; }
}
need curl
need tar
need uname

OS="$(uname -s)"
ARCH="$(uname -m)"
case "${"$"}OS/${"$"}ARCH" in
  Darwin/arm64|Darwin/aarch64) TARGET="macArm64" ;;
  Darwin/x86_64) TARGET="macIntel" ;;
  Linux/x86_64|Linux/amd64) TARGET="linux" ;;
  *)
    echo "Rook CLI does not yet support ${"$"}OS/${"$"}ARCH." >&2
    echo "Download Rook Node instead: ${"$"}BASE_URL/download" >&2
    exit 1
    ;;
esac

ARCHIVE="${"$"}TEMP_DIR/rook-cli.tar.gz"
printf '%s\\n' "Downloading Rook CLI for ${"$"}OS/${"$"}ARCH…"
curl --fail --location --silent --show-error --retry 2 --connect-timeout 10 \\
  "${"$"}BASE_URL/api/download/cli?platform=${"$"}TARGET" -o "${"$"}ARCHIVE"

tar -xzf "${"$"}ARCHIVE" -C "${"$"}TEMP_DIR"
if [ ! -f "${"$"}TEMP_DIR/rook" ]; then
  echo "Rook CLI archive was invalid: executable missing." >&2
  exit 1
fi

mkdir -p "${"$"}INSTALL_DIR"
chmod 755 "${"$"}TEMP_DIR/rook"
mv -f "${"$"}TEMP_DIR/rook" "${"$"}INSTALL_DIR/rook"
if [ -d "${"$"}TEMP_DIR/chromium" ]; then
  rm -rf "${"$"}INSTALL_DIR/chromium"
  mv "${"$"}TEMP_DIR/chromium" "${"$"}INSTALL_DIR/chromium"
fi

"${"$"}INSTALL_DIR/rook" --version
printf '%s\\n' "Rook CLI installed at ${"$"}INSTALL_DIR/rook"
case ":${"$"}PATH:" in
  *":${"$"}INSTALL_DIR:"*) ;;
  *)
    printf '%s\\n' "Add this to your shell profile, then open a new terminal:"
    printf '  export PATH="%s:${"$"}PATH"\\n' "${"$"}INSTALL_DIR"
    ;;
esac
printf '%s\\n' "Run: rook"
`;
}

/** PowerShell equivalent for supported Windows systems. */
export function buildPowerShellCliInstaller(origin: string): string {
  return `$ErrorActionPreference = "Stop"
$BaseUrl = "${origin.replace(/\/$/, "")}" 
$InstallDir = if ($env:ROOK_INSTALL_DIR) { $env:ROOK_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Rook\\bin" }
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("rook-cli-" + [guid]::NewGuid().ToString("N"))
$Archive = Join-Path $TempDir "rook-cli.zip"

try {
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  Write-Host "Downloading Rook CLI for Windows…"
  Invoke-WebRequest -Uri "$BaseUrl/api/download/cli?platform=windows" -OutFile $Archive -UseBasicParsing
  Expand-Archive -LiteralPath $Archive -DestinationPath $TempDir -Force

  $Cli = Join-Path $TempDir "rook.exe"
  if (-not (Test-Path -LiteralPath $Cli)) { throw "Rook CLI archive was invalid: executable missing." }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -LiteralPath $Cli -Destination (Join-Path $InstallDir "rook.exe") -Force
  $Chromium = Join-Path $TempDir "chromium"
  if (Test-Path -LiteralPath $Chromium) {
    $DestinationChromium = Join-Path $InstallDir "chromium"
    Remove-Item -LiteralPath $DestinationChromium -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $Chromium -Destination $DestinationChromium -Force
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ((";" + $UserPath + ";").ToLowerInvariant().Contains((";" + $InstallDir + ";").ToLowerInvariant()) -eq $false) {
    [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(";") + ";" + $InstallDir).TrimStart(";")), "User")
    $env:Path = $env:Path + ";" + $InstallDir
  }

  & (Join-Path $InstallDir "rook.exe") --version
  Write-Host "Rook CLI installed at $InstallDir\\rook.exe"
  Write-Host "Open a new PowerShell window and run: rook"
} finally {
  Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}
