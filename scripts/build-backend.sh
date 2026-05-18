#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_OUT="${OPENYAK_FRONTEND_OUT:-$ROOT_DIR/frontend/out}"

# ── Homebrew expat 查找 (macOS pyexpat 兼容) ──────────────
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

cd "$BACKEND_DIR"

if $CLEAN; then
  rm -rf dist build
fi

# ── Python 版本选择 ────────────────────────────────────────
# 优先使用 python3.12 (python3.13 在 macOS 上有 pyexpat 兼容性问题)
PYTHON_CMD=""
for cmd in python3.12 python3.11 python3; do
  if command -v "$cmd" &>/dev/null; then
    ver=$($cmd -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo 0.0)
    if [[ "$ver" != "3.13" && "$ver" != "3.14" ]]; then
      PYTHON_CMD="$cmd"
      break
    fi
  fi
done
if [[ -z "$PYTHON_CMD" ]]; then
  PYTHON_CMD="python3"
fi
echo "Using Python: $PYTHON_CMD ($($PYTHON_CMD --version 2>&1))"

# ── macOS pyexpat/libexpat 修复 ────────────────────────────
if [ "$(uname -s)" = "Darwin" ]; then
  BREW_EXPAT_PREFIX="$(find_expat_prefix)"
  if [ -z "$BREW_EXPAT_PREFIX" ] || [ ! -f "$BREW_EXPAT_PREFIX/lib/libexpat.dylib" ]; then
    echo "Homebrew expat is required for Python pyexpat on this macOS version." >&2
    echo "Install it with: brew install expat" >&2
    exit 1
  fi
  # 修复 pyexpat.so 的 libexpat 链接
  PYEXPAT_SO=""
  for candidate in \
    "$($PYTHON_CMD -c "import pyexpat;print(pyexpat.__file__)" 2>/dev/null || true)" \
    "$(find "$($PYTHON_CMD -c "import sysconfig;print(sysconfig.get_config_var('LIBDIR'))" 2>/dev/null || echo /dev/null)" -name 'pyexpat.cpython-3*.darwin.so' 2>/dev/null | head -1)" \
    "$(dirname "$(readlink -f "$($PYTHON_CMD -c "import sys;print(sys.executable)" 2>/dev/null || echo /dev/null)" 2>/dev/null || echo /dev/null)")/../lib/python3.1*/lib-dynload/pyexpat.cpython-3*-darwin.so"; do
    if [[ -f "$candidate" ]]; then
      PYEXPAT_SO="$candidate"
      break
    fi
  done
  if [[ -n "$PYEXPAT_SO" ]]; then
    CURRENT_LINK=$(otool -L "$PYEXPAT_SO" 2>/dev/null | grep '/usr/lib/libexpat' | awk '{print $1}' || true)
    if [[ -n "$CURRENT_LINK" ]]; then
      echo "Fixing pyexpat libexpat link: $PYEXPAT_SO → $BREW_EXPAT_PREFIX/lib/libexpat.1.dylib"
      if install_name_tool -change /usr/lib/libexpat.1.dylib "$BREW_EXPAT_PREFIX/lib/libexpat.1.dylib" "$PYEXPAT_SO" 2>/dev/null; then
        codesign --force --sign - "$PYEXPAT_SO" 2>/dev/null || true
        echo "pyexpat libexpat link fixed and re-signed"
      fi
    fi
  fi
fi

# ── 路径和环境 ─────────────────────────────────────────────
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

# ── venv 设置 ──────────────────────────────────────────────
if [ ! -d venv ]; then
  "$PYTHON_CMD" -m venv venv
fi

PYTHON="$BACKEND_DIR/venv/bin/python"
PIP="$BACKEND_DIR/venv/bin/python -m pip"
PYINSTALLER="$BACKEND_DIR/venv/bin/python -m PyInstaller"

# 确保 pip 可用
if ! $PYTHON -m pip --version &>/dev/null; then
  $PYTHON -m ensurepip --upgrade || {
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
    $PYTHON /tmp/get-pip.py
    rm -f /tmp/get-pip.py
  }
fi

# 验证 pyexpat
$PYTHON -c "from xml.parsers import expat; print('Python pyexpat OK')"

$PYTHON -m pip install --upgrade pip --retries 10 --timeout 120 -q
$PIP install -r requirements.txt pyinstaller --retries 10 --timeout 120 -q

# 修补 PyInstaller compat.py mac_ver bug (macOS 26+)
COMPAT_FILE="$(find backend/venv -path '*/PyInstaller/compat.py' 2>/dev/null | head -1 || true)"
if [[ -n "$COMPAT_FILE" ]] && grep -q "for x in platform.mac_ver.*split.*if is_darwin" "$COMPAT_FILE" 2>/dev/null; then
  if ! grep -q "if x)" "$COMPAT_FILE" 2>/dev/null; then
    echo "Patching PyInstaller mac_ver bug..."
    $PYTHON -c "
p = '$COMPAT_FILE'
with open(p) as f: c = f.read()
old = \"int(x) for x in platform.mac_ver()[0].split('.') if is_darwin\"
new = \"int(x) for x in platform.mac_ver()[0].split('.') if x) if is_darwin\"
if old in c and 'if x)' not in c:
    c = c.replace(old, new)
    with open(p, 'w') as f: f.write(c)
    print('Patched')
" 2>/dev/null || true
  fi
fi

# ── PyInstaller 构建 ───────────────────────────────────────
export OPENYAK_FRONTEND_OUT="$FRONTEND_OUT"
$PYINSTALLER openyak.spec --noconfirm

BACKEND_BUNDLE="$BACKEND_DIR/dist/openyak-backend"
BACKEND_BIN="$BACKEND_BUNDLE/openyak-backend"
test -x "$BACKEND_BIN"

# ── macOS: 复制 Homebrew expat dylib 到 bundle ─────────────
if [ "$(uname -s)" = "Darwin" ] && [ -n "${BREW_EXPAT_PREFIX:-}" ]; then
  INTERNAL_DIR="$BACKEND_BUNDLE/_internal"
  cp "$BREW_EXPAT_PREFIX"/lib/libexpat*.dylib "$INTERNAL_DIR/" 2>/dev/null || true
  chmod 755 "$INTERNAL_DIR"/libexpat*.dylib 2>/dev/null || true
fi

echo "Backend built: $BACKEND_BUNDLE"
