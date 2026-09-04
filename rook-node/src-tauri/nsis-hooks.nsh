; Rook Node NSIS installer hooks.
; Kill any running instances before extraction, otherwise file locks make
; the installer fail with "error writing to file" on the sidecar/Chromium.

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping any running Rook Node instances..."
  nsExec::ExecToLog 'taskkill /F /IM "rook-node-sidecar.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "Rook Node.exe"'
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog 'taskkill /F /IM "rook-node-sidecar.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "Rook Node.exe"'
  Sleep 500
!macroend
