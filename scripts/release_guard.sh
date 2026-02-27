#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

echo "[1/5] backup"
bash scripts/backup_project.sh

echo "[2/5] js tests"
make test

echo "[3/5] python syntax check"
python3 -m py_compile backend/app.py
python3 -m py_compile backend/main.py backend/auth.py backend/database.py backend/search.py

echo "[4/5] backend smoke"
bash scripts/backend_smoke.sh

echo "[5/5] react build"
if [[ -d "frontend-react" && -f "frontend-react/package.json" ]]; then
  (cd frontend-react && npm run build)
else
  echo "frontend-react not found, skip"
fi

echo "release guard passed"
