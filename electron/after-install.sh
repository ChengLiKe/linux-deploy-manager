#!/bin/bash
# Debian 包安装后脚本

set -e

APP_NAME="linux-deploy-manager"
INSTALL_DIR="/opt/${APP_NAME}"
BIN_PATH="${INSTALL_DIR}/${APP_NAME}"
LINK_PATH="/usr/local/bin/${APP_NAME}"

# 创建软链接到 PATH
case "$1" in
  configure)
    if [ -e "${LINK_PATH}" ] || [ -L "${LINK_PATH}" ]; then
      rm -f "${LINK_PATH}"
    fi
    ln -s "${BIN_PATH}" "${LINK_PATH}" || true
    ;;
esac

# 更新桌面数据库
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

# 更新图标缓存
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

exit 0
