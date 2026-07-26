#!/bin/bash
# 安装开机自启（macOS LaunchAgent，后台运行，无需开着终端）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.channel-demand.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$ROOT/logs"
OUT_LOG="$LOG_DIR/autostart.out.log"
ERR_LOG="$LOG_DIR/autostart.err.log"

mkdir -p "$LOG_DIR"
mkdir -p "$HOME/Library/LaunchAgents"

# 找 npm（LaunchAgent 拿不到你在终端里配的 PATH）
NPM_BIN=""
for c in /opt/homebrew/bin/npm /usr/local/bin/npm "$(command -v npm 2>/dev/null || true)"; do
  if [[ -n "$c" && -x "$c" ]]; then
    NPM_BIN="$c"
    break
  fi
done

if [[ -z "$NPM_BIN" ]]; then
  echo "找不到 npm。请先安装 Node.js（见 README），再重试。"
  exit 1
fi

NODE_DIR="$(dirname "$NPM_BIN")"
PATH_VALUE="${NODE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin"

# 确保依赖已装
if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "首次安装依赖…"
  (cd "$ROOT" && "$NPM_BIN" install)
fi

# 若已加载则先卸掉
if launchctl print "gui/$(id -u)/${LABEL}" &>/dev/null; then
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
fi
rm -f "$PLIST"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NPM_BIN}</string>
    <string>run</string>
    <string>dev</string>
    <string>--</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>5173</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${PATH_VALUE}</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true

sleep 2

echo ""
echo "已开启开机自启（后台运行，不用开着终端）。"
echo "  项目目录: ${ROOT}"
echo "  使用 npm:  ${NPM_BIN}"
echo "  配置文件: ${PLIST}"
echo "  日志:     ${OUT_LOG}"
echo "            ${ERR_LOG}"
echo ""
echo "浏览器打开: http://127.0.0.1:5173/"
echo "取消自启:   npm run autostart:off"
echo ""
