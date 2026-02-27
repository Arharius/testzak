#!/usr/bin/env bash
set -euo pipefail

PLAYWRIGHT_TMP="/tmp/pw-e2e"
SERVER_LOG="/tmp/tz_e2e_server.log"
REACT_BUILD_LOG="/tmp/tz_e2e_react_build.log"
REACT_PREVIEW_LOG="/tmp/tz_e2e_react_preview.log"

mkdir -p "$PLAYWRIGHT_TMP"

if [ ! -d "$PLAYWRIGHT_TMP/node_modules/playwright" ]; then
  (cd "$PLAYWRIGHT_TMP" && npm init -y >/dev/null 2>&1 && npm install playwright >/dev/null 2>&1)
fi

python3 -m http.server 8765 --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
REACT_PID=""

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  if [[ -n "$REACT_PID" ]]; then
    kill "$REACT_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Give local server a moment to bind.
sleep 1

NODE_PATH="$PLAYWRIGHT_TMP/node_modules" node tests/e2e_browser_check.cjs

# React production-like e2e on Vite preview.
(cd frontend-react && npm run build >"$REACT_BUILD_LOG" 2>&1)
(cd frontend-react && npm run preview -- --host 127.0.0.1 --port 4173 >"$REACT_PREVIEW_LOG" 2>&1) &
REACT_PID=$!
sleep 2

E2E_REACT_BASE_URL="http://127.0.0.1:4173" NODE_PATH="$PLAYWRIGHT_TMP/node_modules" node tests/e2e_react_check.cjs
