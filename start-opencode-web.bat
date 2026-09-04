@echo off
REM Simple double-click launcher - calls PowerShell script
REM Keeps full access to C:\Users\marti\OneDrive\Desktop\Eddie\Rook-
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-opencode-web.ps1" %*
pause
