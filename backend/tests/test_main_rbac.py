import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main as backend_main
from database import Base
from models import TZDocument, User


@pytest.fixture
def rbac_db(tmp_path):
    db_path = tmp_path / "rbac_test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    backend_main.app.dependency_overrides[backend_main.get_db] = override_get_db
    yield TestingSessionLocal
    backend_main.app.dependency_overrides = {}


def _seed_data(SessionLocal):
    with SessionLocal() as db:
        u1 = User(email="a@t1.local", name="A", hashed_password="x", tenant_id="t1", role="admin")
        u2 = User(email="b@t1.local", name="B", hashed_password="x", tenant_id="t1", role="viewer")
        u3 = User(email="c@t2.local", name="C", hashed_password="x", tenant_id="t2", role="manager")
        db.add_all([u1, u2, u3])
        db.commit()
        db.refresh(u1)
        db.refresh(u2)
        db.refresh(u3)
        d1 = TZDocument(user_id=u1.id, tenant_id="t1", title="Doc1", metadata_json="{}", products_json="[]")
        d2 = TZDocument(user_id=u2.id, tenant_id="t1", title="Doc2", metadata_json="{}", products_json="[]")
        d3 = TZDocument(user_id=u3.id, tenant_id="t2", title="Doc3", metadata_json="{}", products_json="[]")
        db.add_all([d1, d2, d3])
        db.commit()
        return u1.id, u2.id, u3.id


@pytest.mark.asyncio
async def test_tenant_isolation_and_role_access(rbac_db):
    u1_id, u2_id, _ = _seed_data(rbac_db)

    class CurrentUser:
        def __init__(self, user_id: int, tenant_id: str, role: str):
            self.id = user_id
            self.tenant_id = tenant_id
            self.role = role

    # Viewer sees only own docs inside tenant
    backend_main.app.dependency_overrides[backend_main.get_current_user] = lambda: CurrentUser(u2_id, "t1", "viewer")
    async with AsyncClient(transport=ASGITransport(app=backend_main.app), base_url="http://test") as client:
        resp = await client.get("/api/documents")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["title"] == "Doc2"

    # Admin sees full tenant docs and can access KPI
    backend_main.app.dependency_overrides[backend_main.get_current_user] = lambda: CurrentUser(u1_id, "t1", "admin")
    async with AsyncClient(transport=ASGITransport(app=backend_main.app), base_url="http://test") as client:
        resp = await client.get("/api/documents")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        kpi = await client.get("/api/tenant/kpi")
        assert kpi.status_code == 200
        data = kpi.json()
        assert data["tenant_id"] == "t1"
        assert data["users_total"] == 2
        assert data["docs_total"] == 2


@pytest.mark.asyncio
async def test_manager_cannot_change_roles(rbac_db):
    _, _, _ = _seed_data(rbac_db)

    class CurrentUser:
        def __init__(self, user_id: int, tenant_id: str, role: str):
            self.id = user_id
            self.tenant_id = tenant_id
            self.role = role

    backend_main.app.dependency_overrides[backend_main.get_current_user] = lambda: CurrentUser(1, "t1", "manager")
    async with AsyncClient(transport=ASGITransport(app=backend_main.app), base_url="http://test") as client:
        resp = await client.post("/api/tenant/users/role", json={"user_id": 2, "role": "viewer"})
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_billing_and_alerts_endpoints(rbac_db):
    u1_id, _, _ = _seed_data(rbac_db)

    class CurrentUser:
        def __init__(self, user_id: int, tenant_id: str, role: str):
            self.id = user_id
            self.tenant_id = tenant_id
            self.role = role

    backend_main.app.dependency_overrides[backend_main.get_current_user] = lambda: CurrentUser(u1_id, "t1", "admin")
    async with AsyncClient(transport=ASGITransport(app=backend_main.app), base_url="http://test") as client:
        evt = await client.post("/api/v1/integration/event", json={"kind": "billing.usage", "payload": {"docs": 1}})
        assert evt.status_code == 200

        billing = await client.get("/api/tenant/billing/summary?price_per_doc_cents=10000")
        assert billing.status_code == 200
        b = billing.json()
        assert b["ok"] is True
        assert b["usage_30d_docs"] >= 1

        sub = await client.get("/api/tenant/subscription")
        assert sub.status_code == 200
        upd = await client.post("/api/tenant/subscription/update", json={"plan_code": "pro", "monthly_price_cents": 49900})
        assert upd.status_code == 200

        alerts = await client.get("/api/tenant/alerts")
        assert alerts.status_code == 200
        assert alerts.json()["ok"] is True
