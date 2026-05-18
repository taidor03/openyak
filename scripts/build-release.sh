#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# build-release.sh — xflow-desktop 发布构建脚本
#
# 用法:
#   ./scripts/build-release.sh            # 完整构建 (前端+后端+桌面)
#   ./scripts/build-release.sh --clean    # 清理后重新构建
#   ./scripts/build-release.sh --sign     # macOS 签名
#
# 构建流程 (参照旧脚本 6e59320 的最佳实践):
#   1. build-frontend.sh  → frontend/out/
#   2. build-backend.sh   → backend/dist/openyak-backend/
#   3. Tauri build (禁用 beforeBuildCommand, 手动管理 resources)
#   4. 手动复制 backend/nodejs 到 .app (cp -R 保留符号链接)
#   5. 生成 DMG (hdiutil UDZO 压缩)
#
# 关键: 手动复制到 .app 而非依赖 Tauri resources 机制,
#       因为 Tauri 解引用符号链接导致体积膨胀 ~50MB。
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/desktop-tauri"
TAURI_CONF="$TAURI_DIR/src-tauri/tauri.conf.json"

# ── 颜色 ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERR]${NC}  $*" >&2; }
step()  { echo -e "${CYAN}━━━▶${NC} $*"; }

# ── 参数解析 ──────────────────────────────────────────────────
CLEAN=false
SIGN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
    --sign)  SIGN=true ;;
    -h|--help)
      echo "用法: $0 [--clean] [--sign]"
      echo "  --clean  清理所有构建产物后重新构建"
      echo "  --sign   macOS 签名"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  OpenYak Desktop 发布构建${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""

cd "$ROOT_DIR"

# ── 清理 ─────────────────────────────────────────────────────
if $CLEAN; then
  step "清理构建产物..."
  rm -rf "$ROOT_DIR/frontend/out" "$ROOT_DIR/frontend/.next"
  rm -rf "$ROOT_DIR/backend/dist" "$ROOT_DIR/backend/build"
  rm -rf "$TAURI_DIR/src-tauri/target/release"
  ok "已清理"
fi

# ── 1. 构建前端 ──────────────────────────────────────────────
step "构建前端..."
bash "$ROOT_DIR/scripts/build-frontend.sh"
ok "前端构建完成"

# ── 2. 构建后端 ──────────────────────────────────────────────
step "构建后端..."
bash "$ROOT_DIR/scripts/build-backend.sh"
ok "后端构建完成"

# ── 3. 确保 Node.js 运行时已下载 ────────────────────────────
if [ ! -d "$ROOT_DIR/backend/resources/nodejs" ]; then
  step "下载 Node.js 运行时..."
  PYTHON_CMD=""
  for cmd in python3.12 python3.11 python3; do
    if command -v "$cmd" &>/dev/null; then
      PYTHON_CMD="$cmd"
      break
    fi
  done
  ${PYTHON_CMD:-python3} "$ROOT_DIR/backend/scripts/download_node.py" --output "$ROOT_DIR/backend/resources/nodejs"
  ok "Node.js 运行时已下载"
fi

# ── 4. 同步桌面元数据 ───────────────────────────────────────
step "同步桌面元数据..."
node "$ROOT_DIR/scripts/sync-desktop-meta.mjs"

# ── 5. 安装 Tauri npm 依赖 ──────────────────────────────────
if [ ! -d "$TAURI_DIR/node_modules" ]; then
  step "安装 Tauri npm 依赖..."
  npm --prefix "$TAURI_DIR" install
fi

# ── 6. 临时修改 tauri.conf.json ─────────────────────────────
# 关键: 禁用 beforeBuildCommand (前端后端已构建完成)
#       清空 resources (手动复制到 .app，避免 Tauri 解引用符号链接)
step "配置 Tauri 构建..."
TAURI_CONF_BAK="$TAURI_CONF.bak"
cp "$TAURI_CONF" "$TAURI_CONF_BAK"
restore_config() {
  if [ -f "$TAURI_CONF_BAK" ]; then
    mv "$TAURI_CONF_BAK" "$TAURI_CONF"
  fi
}
trap restore_config EXIT

python3 - "$TAURI_CONF" "$SIGN" "$ROOT_DIR" <<'PY'
import json
import sys
from pathlib import Path

path, sign, root = sys.argv[1], sys.argv[2] == "true", Path(sys.argv[3])
with open(path, encoding="utf-8") as f:
    cfg = json.load(f)

# 禁用 beforeBuildCommand (前端后端已构建完成)
cfg["build"]["beforeBuildCommand"] = ""

# 清空 resources — 手动复制到 .app，避免 Tauri 解引用符号链接导致体积膨胀
cfg["bundle"]["resources"] = {}

# macOS 签名
if not sign:
    cfg["bundle"].setdefault("macOS", {})["signingIdentity"] = None
    cfg["bundle"]["createUpdaterArtifacts"] = False

with open(path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
ok "Tauri 配置已更新"

# ── 7. Tauri 构建 ────────────────────────────────────────────
step "构建 Tauri 桌面应用..."
(
  cd "$TAURI_DIR"
  export CARGO_TARGET_DIR="$TAURI_DIR/src-tauri/target"
  cargo tauri build --bundles dmg,app
)

# 恢复 tauri.conf.json
restore_config
trap - EXIT

# ── 8. 手动复制 backend/nodejs 到 .app ──────────────────────
step "打包资源到 .app..."

BUNDLE_DIR="$TAURI_DIR/src-tauri/target/release/bundle"
APP_PATH="$(ls -td "$BUNDLE_DIR"/macos/*.app 2>/dev/null | head -1 || true)"

if [ -z "$APP_PATH" ]; then
  err ".app 未找到，Tauri 构建可能失败"
  exit 1
fi

RESOURCES_DIR="$APP_PATH/Contents/Resources"

# 清理 Tauri 可能自动复制的旧资源
rm -rf "$RESOURCES_DIR/backend" "$RESOURCES_DIR/nodejs"

# 复制后端 (cp -R 保留符号链接，避免解引用导致体积膨胀)
info "复制 backend → .app (保留符号链接)..."
cp -R "$ROOT_DIR/backend/dist/openyak-backend" "$RESOURCES_DIR/backend"
chmod +x "$RESOURCES_DIR/backend/openyak-backend"

# 复制 Node.js 运行时
if [ -d "$ROOT_DIR/backend/resources/nodejs" ]; then
  info "复制 nodejs → .app..."
  cp -R "$ROOT_DIR/backend/resources/nodejs" "$RESOURCES_DIR/nodejs"
  chmod +x "$RESOURCES_DIR/nodejs/bin/node" 2>/dev/null || true
fi

# 验证
test -x "$APP_PATH/Contents/Resources/backend/openyak-backend"
ok "资源已打包到 .app"

# ── 9. 报告 .app 大小 ────────────────────────────────────────
APP_SIZE=$(du -sh "$APP_PATH" | awk '{print $1}')
info ".app 大小: $APP_SIZE"
info "  backend: $(du -sh "$RESOURCES_DIR/backend" | awk '{print $1}')"
info "  nodejs:  $(du -sh "$RESOURCES_DIR/nodejs" 2>/dev/null | awk '{print $1}' || echo N/A)"
info "  binary:  $(du -sh "$APP_PATH/Contents/MacOS/openyak-desktop" | awk '{print $1}')"

# ── 10. 生成 DMG ─────────────────────────────────────────────
DMG_PATH="$(ls -t "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null | head -1 || true)"

if [ -n "$DMG_PATH" ] && command -v hdiutil >/dev/null 2>&1; then
  step "生成 DMG 安装包..."

  STAGING_DIR="$BUNDLE_DIR/dmg-staging"
  rm -rf "$STAGING_DIR"
  mkdir -p "$STAGING_DIR"
  cp -R "$APP_PATH" "$STAGING_DIR/OpenYak.app"
  ln -s /Applications "$STAGING_DIR/Applications"
  rm -f "$DMG_PATH"
  hdiutil create -volname "OpenYak" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$STAGING_DIR"

  DMG_SIZE=$(du -sh "$DMG_PATH" | awk '{print $1}')
  ok "DMG 已生成: $DMG_PATH ($DMG_SIZE)"
else
  warn "DMG 未生成 (hdiutil 不可用或 .dmg 不存在)"
fi

# ── 完成 ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ 发布构建完成!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  App: ${CYAN}$APP_PATH${NC} ($APP_SIZE)"
if [ -n "${DMG_PATH:-}" ]; then
  echo -e "  DMG: ${CYAN}$DMG_PATH${NC} ($(du -sh "$DMG_PATH" | awk '{print $1}'))"
fi
echo ""
