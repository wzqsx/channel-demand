#!/bin/bash
# 手动复制备份库存 SQLite（下雨出门前可顺手跑一下）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/data/stock.db"
DEST_DIR="$ROOT/data/backups"
mkdir -p "$DEST_DIR"
if [[ ! -f "$SRC" ]]; then
  echo "还没有 data/stock.db（先 npm run dev 导入过库存后再备份）"
  exit 1
fi
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$DEST_DIR/stock-manual-$STAMP.db"
cp -f "$SRC" "$DEST"
# 顺带拷贝 WAL（若有）
[[ -f "$SRC-wal" ]] && cp -f "$SRC-wal" "$DEST-wal" || true
[[ -f "$SRC-shm" ]] && cp -f "$SRC-shm" "$DEST-shm" || true
echo "已备份: $DEST"
