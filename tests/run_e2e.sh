#!/usr/bin/env bash
set -euo pipefail

PLAYWRIGHT_TMP="/tmp/pw-e2e"
SERVER_LOG="/tmp/tz_e2e_server.log"

mkdir -p "$PLAYWRIGHT_TMP"

if [ ! -d "$PLAYWRIGHT_TMP/node_modules/playwright" ]; then
  (cd "$PLAYWRIGHT_TMP" && npm init -y >/dev/null 2>&1 && npm install playwright >/dev/null 2>&1)
fi

python3 -m http.server 8765 --bind 127.0.0.1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Give local server a moment to bind.
sleep 1

NODE_PATH="$PLAYWRIGHT_TMP/node_modules" node tests/e2e_browser_check.cjs

