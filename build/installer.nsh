; Custom NSIS install/uninstall hooks for RoboTrader AI
; Bundles Microsoft Visual C++ Redistributable 2015-2022 (x64) — required by
; Electron 33 / Chromium 130. Without it, the app fails to launch silently
; (no error, no log) on systems where VC++ is not installed.
;
; vc_redist.x64.exe is downloaded to build/ during build preparation and
; embedded in the installer by electron-builder.

!macro customInstall
  DetailPrint "Verificando Microsoft Visual C++ Redistributable 2015-2022..."
  SetOutPath "$TEMP"
  File "${BUILD_RESOURCES_DIR}\vc_redist.x64.exe"
  ; /install   - install mode
  ; /passive   - show progress bar, no user interaction
  ; /norestart - do not reboot automatically
  ; 0 = success, 3010 = success (reboot required), other = error
  nsExec::ExecToLog '"$TEMP\vc_redist.x64.exe" /install /passive /norestart'
  Pop $0
  Delete "$TEMP\vc_redist.x64.exe"
  ${If} $0 == 0
  ${OrIf} $0 == 3010
    DetailPrint "VC++ Redistributable instalado/atualizado com sucesso."
  ${Else}
    DetailPrint "Aviso: VC++ Redistributable exit code $0 (continuando instalacao)."
  ${EndIf}
!macroend

!macro customUnInstall
  ; We do NOT uninstall VC++ Redistributable because other apps depend on it.
  ; Leaving it preserves the user's environment.
!macroend
