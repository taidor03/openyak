#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_OUT="${OPENYAK_FRONTEND_OUT:-$ROOT_DIR/frontend/out}"

find_expat_prefix() {
  for prefix in /opt/homebrew/opt/expat /usr/local/opt/expat; do
    if [ -f "$prefix/lib/libexpat.dylib" ]; then
      echo "$prefix"
      return 0
    fi
  done
  brew --prefix expat 2>/dev/null || true
}

CLEAN=false
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$FRONTEND_OUT/m.html" ] || [ ! -d "$FRONTEND_OUT/_next" ]; then
  echo "Frontend export is missing or incomplete: $FRONTEND_OUT" >&2
  echo "Run: scripts/build-frontend.sh" >&2
  exit 1
fi

cd "$BACKEND_DIR"

if $CLEAN; then
  rm -rf dist build
fi

if [ "$(uname -s)" = "Darwin" ]; then
  BREW_EXPAT_PREFIX="$(find_expat_prefix)"
  if [ -z "$BREW_EXPAT_PREFIX" ] || [ ! -f "$BREW_EXPAT_PREFIX/lib/libexpat.dylib" ]; then
    echo "Homebrew expat is required for Python pyexpat on this macOS version." >&2
    echo "Install it with: brew install expat" >&2
    exit 1
  fi
  export DYLD_LIBRARY_PATH="$BREW_EXPAT_PREFIX/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
  export PKG_CONFIG_PATH="/opt/homebrew/opt/cairo/lib/pkgconfig:/usr/local/opt/cairo/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
fi
export PIP_DEFAULT_TIMEOUT=120
export PIP_RETRIES=10
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PYINSTALLER_CONFIG_DIR="$BACKEND_DIR/build/pyinstaller-cache"
export MPLCONFIGDIR="$BACKEND_DIR/build/matplotlib-cache"
mkdir -p "$PYINSTALLER_CONFIG_DIR" "$MPLCONFIGDIR"

if [ ! -d venv ]; then
  python3 -m venv venv
fi

PYTHON="$BACKEND_DIR/venv/bin/python"
PIP="$BACKEND_DIR/venv/bin/pip"
PYINSTALLER="$BACKEND_DIR/venv/bin/pyinstaller"

"$PYTHON" - <<'PY'
from xml.parsers import expat
print("Python pyexpat OK")
PY
"$PYTHON" -m pip install --upgrade pip --retries 10 --timeout 120
"$PIP" install -r requirements.txt pyinstaller --retries 10 --timeout 120

export OPENYAK_FRONTEND_OUT="$FRONTEND_OUT"
"$PYINSTALLER" openyak.spec --noconfirm

BACKEND_BUNDLE="$BACKEND_DIR/dist/openyak-backend"
BACKEND_BIN="$BACKEND_BUNDLE/openyak-backend"
test -x "$BACKEND_BIN"

if [ "$(uname -s)" = "Darwin" ] && [ -n "${BREW_EXPAT_PREFIX:-}" ]; then
  INTERNAL_DIR="$BACKEND_BUNDLE/_internal"
  cp "$BREW_EXPAT_PREFIX"/lib/libexpat*.dylib "$INTERNAL_DIR/" 2>/dev/null || true
  chmod 755 "$INTERNAL_DIR"/libexpat*.dylib 2>/dev/null || true
fi

node "$ROOT_DIR/scripts/verify-bundle.mjs" "$BACKEND_BUNDLE"

echo "Backend built: $BACKEND_BUNDLE"
