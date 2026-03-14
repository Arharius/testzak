"""Tests for TZ Generator API endpoints."""
import pytest


class TestHealth:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "ai_providers" in data

    def test_root_returns_version(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert "version" in data

    def test_ping(self, client):
        resp = client.get("/api/v1/ping")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestAuth:
    def test_send_link_valid_email(self, client):
        resp = client.post("/api/auth/send-link", json={"email": "test@example.com"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        # SMTP not configured → magic_link returned
        assert "magic_link" in data

    def test_send_link_invalid_email(self, client):
        resp = client.post("/api/auth/send-link", json={"email": "not-an-email"})
        assert resp.status_code == 422  # Pydantic validation

    def test_send_link_empty_email(self, client):
        resp = client.post("/api/auth/send-link", json={"email": ""})
        assert resp.status_code == 422

    def test_verify_invalid_token(self, client):
        resp = client.get("/api/auth/verify?token=invalid-token-12345")
        assert resp.status_code == 400

    def test_full_auth_flow(self, client):
        # 1. Send link
        resp = client.post("/api/auth/send-link", json={"email": "flow@test.ru"})
        data = resp.json()
        magic_link = data["magic_link"]
        token = magic_link.split("magic=")[-1]

        # 2. Verify
        resp2 = client.get(f"/api/auth/verify?token={token}")
        assert resp2.status_code == 200
        auth_data = resp2.json()
        assert auth_data["ok"] is True
        assert "token" in auth_data
        assert auth_data["user"]["email"] == "flow@test.ru"

        # 3. Get me
        jwt = auth_data["token"]
        resp3 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {jwt}"})
        assert resp3.status_code == 200
        assert resp3.json()["email"] == "flow@test.ru"

    def test_me_without_token(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_token_cannot_be_reused(self, client):
        resp = client.post("/api/auth/send-link", json={"email": "reuse@test.ru"})
        token = resp.json()["magic_link"].split("magic=")[-1]

        # First verify — OK
        resp2 = client.get(f"/api/auth/verify?token={token}")
        assert resp2.status_code == 200

        # Second verify — should fail (token already used)
        resp3 = client.get(f"/api/auth/verify?token={token}")
        assert resp3.status_code == 400


class TestSearch:
    def test_search_specs_empty_product(self, client):
        resp = client.post("/api/search/specs", json={"product": "", "goods_type": "pc"})
        assert resp.status_code == 400

    def test_search_eis_empty_query(self, client):
        resp = client.post("/api/search/eis", json={"query": "", "goods_type": "pc"})
        assert resp.status_code == 400

    def test_search_specs_returns_list(self, client):
        resp = client.post("/api/search/specs", json={"product": "test laptop", "goods_type": "laptop"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert isinstance(data["specs"], list)


class TestTZDocuments:
    def test_list_requires_auth(self, client):
        resp = client.get("/api/tz/list")
        assert resp.status_code == 401

    def test_save_and_list(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}

        # Save
        resp = client.post("/api/tz/save", json={
            "title": "Тестовое ТЗ",
            "law_mode": "44",
            "rows": [{"type": "pc", "model": "Test PC", "qty": 5, "specs": [{"name": "CPU", "value": "не менее 4 ядер", "unit": ""}]}],
        }, headers=headers)
        assert resp.status_code == 200
        doc_id = resp.json()["id"]

        # List
        resp2 = client.get("/api/tz/list", headers=headers)
        assert resp2.status_code == 200
        items = resp2.json()["items"]
        assert any(d["id"] == doc_id for d in items)

        # Get
        resp3 = client.get(f"/api/tz/{doc_id}", headers=headers)
        assert resp3.status_code == 200
        assert resp3.json()["doc"]["title"] == "Тестовое ТЗ"

        # Update
        resp4 = client.put(f"/api/tz/{doc_id}", json={"title": "Обновлённое ТЗ"}, headers=headers)
        assert resp4.status_code == 200

        # Delete
        resp5 = client.delete(f"/api/tz/{doc_id}", headers=headers)
        assert resp5.status_code == 200

    def test_get_nonexistent_doc(self, client, admin_token):
        resp = client.get("/api/tz/nonexistent-id", headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 404


class TestEnterprise:
    def test_enterprise_health(self, client):
        resp = client.get("/api/v1/enterprise/health")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_enterprise_autopilot_simulation(self, client):
        resp = client.post("/api/v1/enterprise/autopilot", json={
            "payload": {"items": [{"type": "pc"}]},
            "settings": {"simulationMode": True},
            "procedure_id": "TEST-001",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["result"]["stages_total"] > 0


class TestRateLimiting:
    def test_auth_rate_limit_returns_429(self, client):
        """Rate limiter responds with 429 and a proper JSON body."""
        # Previous tests already consumed part of the auth budget.
        # Just keep sending until we get a 429 (or exhaust 10 attempts).
        got_429 = False
        for i in range(10):
            resp = client.post("/api/auth/send-link", json={"email": f"rl{i}@test.ru"})
            if resp.status_code == 429:
                got_429 = True
                assert "detail" in resp.json()
                break
        assert got_429, "Expected 429 from rate limiter but never got one"
