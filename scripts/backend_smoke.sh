#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

python3 - << 'PY'
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)

r = client.get("/health")
assert r.status_code == 200, r.text
assert r.json().get("status") == "ok", r.text

r = client.get("/api/v1/ping")
assert r.status_code == 200, r.text
assert r.json().get("message") == "pong", r.text

r = client.post("/api/v1/integration/event", json={
    "kind": "smoke.event",
    "source": "smoke",
    "payload": {"ok": True}
})
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

r = client.get("/api/v1/integration/queue")
assert r.status_code == 200, r.text
assert "queue_total" in r.json(), r.text

print("backend smoke passed")
PY
