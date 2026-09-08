# setup-opencode-web-firewall.ps1
# MUST be run as Administrator (right-click -> Run as Administrator)
# - Sets Wi-Fi to Private (so Private firewall rule works, keeps access Same-WiFi only)
# - Creates inbound firewall rule for opencode web on port 4096, Private profile ONLY
#   (this blocks Public/Internet access, only devices on your trusted WiFi can connect)

param([int]$Port = 4096)

# Self-elevate if not admin
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Not running as Administrator - relaunching elevated..." -ForegroundColor Yellow
  Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Port $Port" -Verb RunAs
  exit
}

Write-Host "Running as Administrator - configuring firewall..." -ForegroundColor Green

# 1. Ensure Wi-Fi is Private (required for Private-only rule)
try {
  $wifiProfile = Get-NetConnectionProfile -InterfaceAlias "Wi-Fi" -ErrorAction SilentlyContinue
  if ($wifiProfile -and $wifiProfile.NetworkCategory -ne "Private") {
    Write-Host "Wi-Fi currently '$($wifiProfile.NetworkCategory)' -> setting to Private..." -ForegroundColor Yellow
    Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
    Write-Host "Wi-Fi set to Private." -ForegroundColor Green
  } else {
    Write-Host "Wi-Fi already Private (or not found, assuming ok)." -ForegroundColor Green
  }
} catch { Write-Host "Failed to set NetworkCategory: $_" -ForegroundColor Red }

# 2. Create firewall rule - Private only (secure, same WiFi only)
$ruleName = "opencode-web $Port"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Removing old rule '$ruleName'..." -ForegroundColor DarkGray
  Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
}

Write-Host "Creating firewall rule '$ruleName' (TCP $Port, Private only, Allow)..." -ForegroundColor Green
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private -Description "OpenCode Web - same WiFi phone access only" | Out-Null

# Verify
Get-NetFirewallRule -DisplayName $ruleName | Format-List DisplayName,Enabled,Direction,Action,Profile
Get-NetFirewallPortFilter -AssociatedNetFirewallRule (Get-NetFirewallRule -DisplayName $ruleName) | Format-List Protocol,LocalPort

Write-Host ""
Write-Host "Done! Firewall now allows port $Port on Private networks only." -ForegroundColor Green
Write-Host "If you later switch WiFi to Public, phone will be BLOCKED (by design for security)." -ForegroundColor DarkGray
Write-Host "To undo: Remove-NetFirewallRule -DisplayName '$ruleName'" -ForegroundColor DarkGray
pause
