#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

python3 - << 'PY'
import os
os.environ["INTEGRATION_ALLOW_ANON"] = "1"
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
    "payload": {"ok": True},
    "idempotency_key": "smoke-idem-1"
})
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

r2 = client.post("/api/v1/integration/event", json={
    "kind": "smoke.event",
    "source": "smoke",
    "payload": {"ok": True},
    "idempotency_key": "smoke-idem-1"
})
assert r2.status_code == 200, r2.text
assert r2.json().get("duplicate") is True, r2.text

r = client.get("/api/v1/integration/queue")
assert r.status_code == 200, r.text
assert "queue_total" in r.json(), r.text

r = client.post("/api/v1/integration/audit", json={"limit": 10})
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

print("backend smoke passed")
PY

python3 - << 'PY'
import os
import tempfile
import sys
from pathlib import Path
from fastapi.testclient import TestClient

tmp_dir = tempfile.mkdtemp(prefix="tz_main_smoke_")
os.environ["INTEGRATION_STORE_FILE"] = f"{tmp_dir}/store.json"
os.environ["INTEGRATION_AUDIT_DB"] = f"{tmp_dir}/audit.db"
os.environ["INTEGRATION_API_TOKEN"] = ""
os.environ["INTEGRATION_ALLOW_ANON"] = "1"
sys.path.insert(0, str(Path.cwd() / "backend"))

from backend.main import app  # noqa: E402

client = TestClient(app)

r = client.get("/health")
assert r.status_code == 200, r.text
assert r.json().get("status") == "ok", r.text

r = client.post("/api/v1/integration/event", json={
    "kind": "smoke.main.event",
    "source": "smoke",
    "payload": {"ok": True},
    "idempotency_key": "smoke-main-idem-1"
})
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

r2 = client.post("/api/v1/integration/event", json={
    "kind": "smoke.main.event",
    "source": "smoke",
    "payload": {"ok": True},
    "idempotency_key": "smoke-main-idem-1"
})
assert r2.status_code == 200, r2.text
assert r2.json().get("duplicate") is True, r2.text

r = client.get("/api/v1/integration/queue")
assert r.status_code == 200, r.text
assert "queue_total" in r.json(), r.text

r = client.get("/api/v1/enterprise/health")
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

r = client.post("/api/v1/enterprise/autopilot", json={
    "payload": {"procedure_id": "123", "profile": "eis"},
    "settings": {},
    "procedure_id": "123"
})
assert r.status_code == 200, r.text
assert r.json().get("ok") is True, r.text

print("backend main smoke passed")
PY
