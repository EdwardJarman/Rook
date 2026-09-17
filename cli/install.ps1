# Rook CLI - one-script install (Windows).
#
#   From a checkout:   .\cli\install.ps1
#   From anywhere:     irm https://raw.githubusercontent.com/EdwardJarman/Rook/main/cli/install.ps1 | iex
#
# Builds the self-contained bundle (deps included) and drops `rook` into
# %LOCALAPPDATA%\Rook\bin (added to your user PATH). Then: rook login
$ErrorActionPreference = "Stop"

$Repo = "https://github.com/EdwardJarman/Rook.git"
$Ref = if ($env:ROOK_REF) { $env:ROOK_REF } else { "main" }
$BinDir = if ($env:ROOK_BIN_DIR) { $env:ROOK_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Rook\bin" }

function Need($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Write-Error "rook install: missing '$Name' - please install it first."
  }
}

Need "node"
Need "npm"
$Major = (& node -e "console.log(process.versions.node.split('.')[0])").Trim()
if ([int]$Major -lt 20) { Write-Error "rook install: node >= 20 required (found $(node --version))." }

$Work = ""
try {
  if ((Test-Path "./cli/package.json") -and (Test-Path "./cli/src")) {
    $Src = "./cli"
  } else {
    Need "git"
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
  # Extensionless `rook` does not execute on Windows; ship a shim.
  Set-Content -Path (Join-Path $BinDir "rook.cmd") -Value '@node "%~dp0rook.cjs" %*' -NoNewline

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($UserPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinDir", "User")
    Write-Host "rook install: added $BinDir to your user PATH (new terminals pick it up)."
  }

  $Version = & (Join-Path $BinDir "rook.cmd") version 2>$null
  if ($LASTEXITCODE -eq 0 -and $Version) {
    Write-Host "rook install: done - rook $Version at $BinDir\rook.cmd"
    Write-Host "Next: rook login"
  } else {
    Write-Error "rook install: build ok, but rook did not run - check node is on your PATH."
  }
} finally {
  if ($Work -and (Test-Path $Work)) { Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue }
}
