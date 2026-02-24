#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAYWRIGHT_TMP="${PLAYWRIGHT_TMP:-/tmp/tz_playwright}"
PORT="${E2E_PORT:-8765}"
BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${PORT}/legacy/index.html}"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "${PLAYWRIGHT_TMP}"
if [[ ! -d "${PLAYWRIGHT_TMP}/node_modules/playwright" ]]; then
  npm --prefix "${PLAYWRIGHT_TMP}" init -y >/dev/null 2>&1 || true
  if ! npm_config_fetch_retries=2 npm_config_fetch_timeout=20000 npm --prefix "${PLAYWRIGHT_TMP}" install playwright@1.49.1; then
    echo "Failed to install playwright dependencies."
    exit 1
  fi
fi

cd "${ROOT_DIR}"
python3 -m http.server "${PORT}" --bind 127.0.0.1 >/tmp/tz_e2e_http.log 2>&1 &
SERVER_PID=$!
sleep 1

NODE_PATH="${PLAYWRIGHT_TMP}/node_modules" E2E_BASE_URL="${BASE_URL}" node tests/e2e_browser_check.cjs
