#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

cd "$FRONTEND_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

export DESKTOP_BUILD=true
export NEXT_PUBLIC_DESKTOP_BUILD=true

npm run build

test -f "$FRONTEND_DIR/out/m.html"
test -d "$FRONTEND_DIR/out/_next"

echo "Frontend built: $FRONTEND_DIR/out"
