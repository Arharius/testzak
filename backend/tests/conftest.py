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
    from auth import create_jwt, get_or_create_user
    from main import SessionLocal

    db = SessionLocal()
    try:
        user = get_or_create_user("admin@test.ru", db)
        user.role = "admin"
        user.tz_limit = -1
        db.commit()
        return create_jwt(user.email, user.role)
    finally:
        db.close()
