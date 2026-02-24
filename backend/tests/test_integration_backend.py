import importlib

import pytest
from httpx import ASGITransport, AsyncClient

backend_app = importlib.import_module("app")


@pytest.fixture
def isolated_backend(monkeypatch, tmp_path):
    store_file = tmp_path / "integration_store.json"
    audit_db = tmp_path / "integration_audit.db"

    monkeypatch.setattr(backend_app, "STORE_FILE", store_file)
    monkeypatch.setattr(backend_app, "AUDIT_DB_FILE", audit_db)
    monkeypatch.setattr(backend_app, "TARGET_WEBHOOK_URL", "")
    monkeypatch.setattr(backend_app, "TARGET_WEBHOOK_TIMEOUT", 1.0)
    monkeypatch.setattr(backend_app, "INTEGRATION_API_TOKEN", "")
    monkeypatch.setattr(backend_app, "INTEGRATION_MAX_ATTEMPTS", 2)
    backend_app.init_audit_db()
    backend_app.save_store(backend_app._default_store())
    return backend_app.app


@pytest.mark.asyncio
async def test_metrics_queue_without_auth_when_token_disabled(isolated_backend):
    async with AsyncClient(transport=ASGITransport(app=isolated_backend), base_url="http://test") as client:
        post = await client.post(
            "/api/v1/integration/event",
            json={"kind": "tz.generated.react", "source": "react", "payload": {"ok": True}},
        )
        assert post.status_code == 200
        queue = await client.get("/api/v1/integration/queue")
        assert queue.status_code == 200
        queue_data = queue.json()
        assert queue_data["queue_total"] == 1
        assert queue_data["dead_letter_total"] == 0

        metrics = await client.get("/api/v1/integration/metrics")
        assert metrics.status_code == 200
        m = metrics.json()["metrics"]
        assert m["queue_total"] == 1
        assert m["dead_letter_total"] == 0
        assert m["integration_max_attempts"] == 2


@pytest.mark.asyncio
async def test_auth_required_when_token_enabled(monkeypatch, tmp_path):
    store_file = tmp_path / "integration_store_auth.json"
    audit_db = tmp_path / "integration_audit_auth.db"
    monkeypatch.setattr(backend_app, "STORE_FILE", store_file)
    monkeypatch.setattr(backend_app, "AUDIT_DB_FILE", audit_db)
    monkeypatch.setattr(backend_app, "TARGET_WEBHOOK_URL", "")
    monkeypatch.setattr(backend_app, "INTEGRATION_API_TOKEN", "secret-token")
    backend_app.init_audit_db()
    backend_app.save_store(backend_app._default_store())

    async with AsyncClient(transport=ASGITransport(app=backend_app.app), base_url="http://test") as client:
        no_auth = await client.post(
            "/api/v1/integration/event",
            json={"kind": "tz.generated.react", "source": "react", "payload": {}},
        )
        assert no_auth.status_code == 401

        yes_auth = await client.post(
            "/api/v1/integration/event",
            headers={"Authorization": "Bearer secret-token"},
            json={"kind": "tz.generated.react", "source": "react", "payload": {}},
        )
        assert yes_auth.status_code == 200


@pytest.mark.asyncio
async def test_dead_letter_after_max_attempts(monkeypatch, tmp_path):
    store_file = tmp_path / "integration_store_dead.json"
    audit_db = tmp_path / "integration_audit_dead.db"
    monkeypatch.setattr(backend_app, "STORE_FILE", store_file)
    monkeypatch.setattr(backend_app, "AUDIT_DB_FILE", audit_db)
    monkeypatch.setattr(backend_app, "TARGET_WEBHOOK_URL", "http://127.0.0.1:1/unreachable")
    monkeypatch.setattr(backend_app, "TARGET_WEBHOOK_TIMEOUT", 0.5)
    monkeypatch.setattr(backend_app, "INTEGRATION_API_TOKEN", "")
    monkeypatch.setattr(backend_app, "INTEGRATION_MAX_ATTEMPTS", 2)
    backend_app.init_audit_db()
    backend_app.save_store(backend_app._default_store())

    async with AsyncClient(transport=ASGITransport(app=backend_app.app), base_url="http://test") as client:
        created = await client.post(
            "/api/v1/integration/event",
            json={"kind": "tz.generated.react", "source": "react", "payload": {"model": "x"}},
        )
        assert created.status_code == 200

        flush1 = await client.post("/api/v1/integration/flush", json={"limit": 100})
        assert flush1.status_code == 200
        assert flush1.json()["dead_lettered"] == 0

        flush2 = await client.post("/api/v1/integration/flush", json={"limit": 100})
        assert flush2.status_code == 200
        assert flush2.json()["dead_lettered"] == 1

        queue = await client.get("/api/v1/integration/queue")
        assert queue.status_code == 200
        q = queue.json()
        assert q["queue_total"] == 0
        assert q["dead_letter_total"] == 1

