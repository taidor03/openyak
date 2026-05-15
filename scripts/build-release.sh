#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/desktop-tauri"
TAURI_CONF="$TAURI_DIR/src-tauri/tauri.conf.json"

CLEAN=false
SIGN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
    --sign) SIGN=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if $CLEAN; then
  rm -rf "$ROOT_DIR/frontend/out" "$ROOT_DIR/frontend/.next"
  rm -rf "$ROOT_DIR/backend/dist" "$ROOT_DIR/backend/build"
  rm -rf "$TAURI_DIR/src-tauri/target/release"
fi

bash "$ROOT_DIR/scripts/build-frontend.sh"
bash "$ROOT_DIR/scripts/build-backend.sh"
node "$ROOT_DIR/scripts/sync-desktop-meta.mjs"

if [ ! -d "$TAURI_DIR/node_modules" ]; then
  npm --prefix "$TAURI_DIR" install
fi

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

cfg["build"]["beforeBuildCommand"] = ""
resources = {
    str(root / "backend" / "dist" / "openyak-backend") + "/": "backend/",
}
nodejs = root / "backend" / "resources" / "nodejs"
if nodejs.exists():
    resources[str(nodejs) + "/"] = "nodejs/"
cfg["bundle"]["resources"] = resources
if not sign:
    cfg["bundle"].setdefault("macOS", {})["signingIdentity"] = None
    cfg["bundle"]["createUpdaterArtifacts"] = False

with open(path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY

(
  cd "$TAURI_DIR"
  export CARGO_TARGET_DIR="$TAURI_DIR/src-tauri/target"
  cargo tauri build --bundles dmg,app
)

restore_config
trap - EXIT

BUNDLE_DIR="$TAURI_DIR/src-tauri/target/release/bundle"
APP_PATH="$(ls -td "$BUNDLE_DIR"/macos/*.app 2>/dev/null | head -1 || true)"
DMG_PATH="$(ls -t "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null | head -1 || true)"

test -n "$APP_PATH"

RESOURCES_DIR="$APP_PATH/Contents/Resources"
rm -rf "$RESOURCES_DIR/backend" "$RESOURCES_DIR/nodejs"
cp -R "$ROOT_DIR/backend/dist/openyak-backend" "$RESOURCES_DIR/backend"
chmod +x "$RESOURCES_DIR/backend/openyak-backend"
if [ -d "$ROOT_DIR/backend/resources/nodejs" ]; then
  cp -R "$ROOT_DIR/backend/resources/nodejs" "$RESOURCES_DIR/nodejs"
fi

test -x "$APP_PATH/Contents/Resources/backend/openyak-backend"

if [ -n "$DMG_PATH" ] && command -v hdiutil >/dev/null 2>&1; then
  STAGING_DIR="$BUNDLE_DIR/dmg-staging"
  rm -rf "$STAGING_DIR"
  mkdir -p "$STAGING_DIR"
  cp -R "$APP_PATH" "$STAGING_DIR/OpenYak.app"
  ln -s /Applications "$STAGING_DIR/Applications"
  rm -f "$DMG_PATH"
  hdiutil create -volname "OpenYak" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$STAGING_DIR"
fi

echo "App built: $APP_PATH"
if [ -n "$DMG_PATH" ]; then
  echo "DMG built: $DMG_PATH"
fi
