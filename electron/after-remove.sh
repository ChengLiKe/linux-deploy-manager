#!/bin/bash
# Debian 包卸载后脚本

set -e

APP_NAME="linux-deploy-manager"
LINK_PATH="/usr/local/bin/${APP_NAME}"

# 删除软链接
if [ -L "${LINK_PATH}" ] || [ -e "${LINK_PATH}" ]; then
  rm -f "${LINK_PATH}" || true
fi

# 更新桌面数据库
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

# 更新图标缓存
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi

exit 0
