#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INTERVAL_SEC="${WORKER_INTERVAL_SEC:-30}"
FLUSH_LIMIT="${WORKER_FLUSH_LIMIT:-100}"

cd "${PROJECT_ROOT}"

echo "integration worker started: interval=${INTERVAL_SEC}s limit=${FLUSH_LIMIT}"

while true; do
  python3 - << PY
from backend.app import flush_queue
result = flush_queue(${FLUSH_LIMIT})
print(result)
PY
  sleep "${INTERVAL_SEC}"
done
