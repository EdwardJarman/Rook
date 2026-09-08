; Rook NSIS installer hooks.
; Upgrades over an existing install were producing a broken layout (the
; sidecar and uninstaller missing) — the old binary name stayed locked and
; half-deleted files from the previous uninstaller raced the extraction.
; The install dir holds no user data (it lives in %APPDATA%/com.rook.desktop),
; so PREINSTALL stops every instance and clears the directory for a clean
; extract.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running Rook instances..."
  nsExec::ExecToLog 'taskkill /F /IM "rook-node.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "rook-node-sidecar.exe"'
  Sleep 1200
  DetailPrint "Clearing previous installation files..."
  RMDir /r "$INSTDIR"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "rook-node.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "rook-node-sidecar.exe"'
  Sleep 500
!macroend
