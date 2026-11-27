!macro customInstall
  Push $0
  FileOpen $0 "$INSTDIR\resources\nsis-install" w
  FileWrite $0 "nsis"
  FileClose $0
  Pop $0
!macroend

!macro customUnInstall
  Delete "$INSTDIR\resources\nsis-install"
!macroend
