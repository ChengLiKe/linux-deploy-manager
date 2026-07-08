; NSIS 自定义安装脚本
; 用于添加/移除 Windows 开机自启动注册表项

!macro customInstall
  ; 安装完成时写入注册表：开机自启动（当前用户）
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "LinuxDeployManager" "$INSTDIR\\${PRODUCT_FILENAME}.exe"
!macroend

!macro customUnInstall
  ; 卸载时移除开机自启动注册表项
  DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "LinuxDeployManager"
!macroend
