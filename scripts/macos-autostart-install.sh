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
CANDIDATES=(
  /opt/homebrew/bin/npm
  /usr/local/bin/npm
)
# nvm 常见路径
if [[ -d "$HOME/.nvm/versions/node" ]]; then
  # shellcheck disable=SC2012
  LATEST_NVM="$(ls -1d "$HOME/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -n "$LATEST_NVM" && -x "$LATEST_NVM/bin/npm" ]]; then
    CANDIDATES+=("$LATEST_NVM/bin/npm")
  fi
fi
if command -v npm &>/dev/null; then
  CANDIDATES+=("$(command -v npm)")
fi

for c in "${CANDIDATES[@]}"; do
  if [[ -n "$c" && -x "$c" ]]; then
    NPM_BIN="$c"
    break
  fi
done

if [[ -z "$NPM_BIN" ]]; then
  echo "找不到 npm（Node.js 未安装或未加入 PATH）。"
  echo "请先在本机终端执行："
  echo "  brew install node"
  echo "  # 若 brew 也找不到：先装 Homebrew，见 README"
  echo "  node -v && npm -v"
  echo "确认有版本号后，再执行：npm run autostart:on"
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
    <string>localhost</string>
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
echo "浏览器打开: http://localhost:5173/"
echo "（请固定用 localhost；npm run dev 会同时启动库存 SQLite :8787）"
echo "库存库文件: ${ROOT}/data/stock.db （可直接复制备份）"
echo "取消自启:   npm run autostart:off"
echo ""
