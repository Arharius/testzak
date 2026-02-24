#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAYWRIGHT_TMP="${PLAYWRIGHT_TMP:-/tmp/tz_playwright}"
PORT="${REACT_E2E_PORT:-4173}"
BASE_URL="${REACT_E2E_BASE_URL:-http://127.0.0.1:${PORT}}"

cleanup() {
  if [[ -n "${PREVIEW_PID:-}" ]] && kill -0 "${PREVIEW_PID}" >/dev/null 2>&1; then
    kill "${PREVIEW_PID}" >/dev/null 2>&1 || true
    wait "${PREVIEW_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

mkdir -p "${PLAYWRIGHT_TMP}"
if [[ ! -d "${PLAYWRIGHT_TMP}/node_modules/playwright" ]]; then
  npm --prefix "${PLAYWRIGHT_TMP}" init -y >/dev/null 2>&1 || true
  npm --prefix "${PLAYWRIGHT_TMP}" install playwright@1.49.1
fi

cd "${ROOT_DIR}/frontend-react"
npm run build >/tmp/tz_react_build.log 2>&1
npm run preview -- --host 127.0.0.1 --port "${PORT}" >/tmp/tz_react_preview.log 2>&1 &
PREVIEW_PID=$!
sleep 2

cd "${ROOT_DIR}"
NODE_PATH="${PLAYWRIGHT_TMP}/node_modules" REACT_E2E_BASE_URL="${BASE_URL}" node tests/react_e2e_check.cjs
