# Rook CLI reinstall (Windows): removes the installed copy, then installs
# fresh. Your sign-in is kept (config dir untouched).
#
#   From a checkout:   .\cli\reinstall.ps1
#   From anywhere:     irm https://raw.githubusercontent.com/EdwardJarman/Rook/main/cli/reinstall.ps1 | iex
$ErrorActionPreference = "Stop"

$BinDir = if ($env:ROOK_BIN_DIR) { $env:ROOK_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Rook\bin" }

foreach ($name in @("rook.cjs", "rook.cmd", "rook.exe")) {
  $target = Join-Path $BinDir $name
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Force
    Write-Host "rook reinstall: removed $target"
  }
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -like "*$BinDir*") {
  # Drop our entry; the installer re-adds it. Keeps PATH edits idempotent.
  $parts = $UserPath -split ";" | Where-Object { $_ -ne "" -and $_ -ne $BinDir }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")
  if ($env:Path -like "*$BinDir*") {
    $env:Path = (($env:Path -split ";" | Where-Object { $_ -ne "" -and $_ -ne $BinDir }) -join ";")
  }
  Write-Host "rook reinstall: cleared the old PATH entry (re-added on install)."
}

$LocalInstaller = ""
if ($PSCommandPath) {
  $LocalInstaller = Join-Path (Split-Path $PSCommandPath -Parent) "install.ps1"
}
if ($LocalInstaller -and (Test-Path -LiteralPath $LocalInstaller)) {
  Write-Host "rook reinstall: installing from this checkout..."
  & $LocalInstaller
} else {
  $Ref = if ($env:ROOK_REF) { $env:ROOK_REF } else { "main" }
  Write-Host "rook reinstall: fetching the installer..."
  $remote = Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/EdwardJarman/Rook/$Ref/cli/install.ps1"
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("rook-install-" + [System.Guid]::NewGuid().ToString("N") + ".ps1")
  try {
    Set-Content -Path $tmp -Value $remote.Content -NoNewline
    & $tmp
  } finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  }
}
