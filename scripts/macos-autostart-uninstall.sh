#!/bin/bash
# 取消开机自启
set -euo pipefail

LABEL="com.channel-demand.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"

if launchctl print "gui/${UID_NUM}/${LABEL}" &>/dev/null; then
  launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
  echo "已停止后台服务: ${LABEL}"
else
  echo "当前没有在运行的自启服务（或已停止）"
fi

if [[ -f "$PLIST" ]]; then
  rm -f "$PLIST"
  echo "已删除配置: ${PLIST}"
fi

echo "完成。之后需要时再用: npm run autostart:on"
