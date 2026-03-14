"""Shared pytest fixtures for TZ Generator backend tests."""
import os
import sys

# Ensure backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Force SQLite for tests (no PostgreSQL needed)
os.environ["DATABASE_URL"] = "sqlite:///test_tz.db"
os.environ["JWT_SECRET"] = "test-secret-for-pytest"
os.environ["INTEGRATION_ALLOW_ANON"] = "1"
os.environ["ENTERPRISE_SIMULATION_MODE"] = "1"

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def client():
    """FastAPI test client with SQLite backend."""
    from main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def admin_token(client):
    """Get admin JWT token."""
    # Create magic link
    resp = client.post("/api/auth/send-link", json={"email": "admin@test.ru"})
    assert resp.status_code == 200
    data = resp.json()
    magic_link = data.get("magic_link", "")
    # Extract token from link
    token = magic_link.split("magic=")[-1] if "magic=" in magic_link else ""
    # Verify token
    resp2 = client.get(f"/api/auth/verify?token={token}")
    assert resp2.status_code == 200
    return resp2.json()["token"]
