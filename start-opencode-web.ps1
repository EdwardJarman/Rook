# start-opencode-web.ps1
# Secure OpenCode Web launcher for same-WiFi phone access
# - Binds to 0.0.0.0 so phone on same WiFi can connect
# - Keeps FULL filesystem access to this local folder: C:\Users\marti\OneDrive\Desktop\Eddie\Rook-
# - Password-protected (same as docs: OPENCODE_SERVER_PASSWORD)
# Usage: right-click -> Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File .\start-opencode-web.ps1

param(
  [int]$Port = 4096,
  [string]$Hostname = "0.0.0.0"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

# --- Load credentials (stored outside repo for security) ---
$CredFile = "C:\Users\marti\.config\opencode\.web-password"
$DefaultUser = "opencode"

if (Test-Path -LiteralPath $CredFile) {
  $Password = (Get-Content -LiteralPath $CredFile -Raw).Trim()
} elseif ($env:OPENCODE_SERVER_PASSWORD) {
  $Password = $env:OPENCODE_SERVER_PASSWORD
} else {
  Write-Host "No password file found at $CredFile and OPENCODE_SERVER_PASSWORD not set." -ForegroundColor Yellow
  $Password = Read-Host "Enter password for opencode web (will be saved to $CredFile)" -AsSecureString | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }
  if (-not $Password) { Write-Error "Password required. Aborting."; exit 1 }
  New-Item -ItemType Directory -Path (Split-Path $CredFile) -Force | Out-Null
  Set-Content -LiteralPath $CredFile -Value $Password -NoNewline -Force
  # restrict ACL
  try {
    $acl = Get-Acl -LiteralPath $CredFile
    $acl.SetAccessRuleProtection($true,$false)
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user,"FullControl","Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $CredFile -AclObject $acl
  } catch {}
  Write-Host "Saved password to $CredFile (restricted to current user)" -ForegroundColor Green
}

if (-not $Password) { Write-Error "OPENCODE_SERVER_PASSWORD is empty"; exit 1 }

$env:OPENCODE_SERVER_PASSWORD = $Password
if (-not $env:OPENCODE_SERVER_USERNAME) { $env:OPENCODE_SERVER_USERNAME = $DefaultUser }

# --- Show network info ---
$WifiIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "192.168.*" }).IPAddress
if (-not $WifiIp) { $WifiIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select-Object -First 1).IPAddress }
if (-not $WifiIp) { $WifiIp = "192.168.0.124" } # fallback from earlier detection

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " OpenCode Web - Secure Same-WiFi Setup" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Project (full access): $ProjectRoot" -ForegroundColor Green
Write-Host "   -> OpenCode retains FULL access to local files (hostname binding only affects network, not filesystem)." -ForegroundColor DarkGray
Write-Host " Local URL:   http://localhost:$Port" -ForegroundColor White
Write-Host " Phone URL:   http://$WifiIp`:$Port  (same WiFi only)" -ForegroundColor Yellow
Write-Host " Username:    $env:OPENCODE_SERVER_USERNAME" -ForegroundColor White
Write-Host " Password:    $Password" -ForegroundColor White
Write-Host "   (stored at $CredFile, not in git)" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# --- Firewall hint ---
$fw = Get-NetFirewallRule -DisplayName "opencode-web $Port" -ErrorAction SilentlyContinue
if (-not $fw) {
  Write-Host "Firewall: rule 'opencode-web $Port' not found." -ForegroundColor Yellow
  Write-Host "  -> Run setup-firewall.ps1 as Administrator (right-click Run as Admin) to allow Private WiFi only." -ForegroundColor Yellow
} else {
  Write-Host "Firewall: rule 'opencode-web $Port' exists -> $($fw.Enabled) $($fw.Profile)" -ForegroundColor Green
}

$profile = (Get-NetConnectionProfile -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue).NetworkCategory
if ($profile -eq "Public") {
  Write-Host "WARNING: Wi-Fi is currently 'Public'. Firewall Private rule will BLOCK it." -ForegroundColor Red
  Write-Host "  -> Run setup-firewall.ps1 as Admin to auto-switch Wi-Fi to Private, or manually: Settings > Network > Wi-Fi > Properties > Private" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Starting: opencode web --hostname $Hostname --port $Port" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop. Keep this window open." -ForegroundColor DarkGray
Write-Host ""

# --- Launch ---
opencode web --hostname $Hostname --port $Port
