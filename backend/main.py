from fastapi import FastAPI, HTTPException, Depends
from fastapi import Request as FastAPIRequest
from pydantic import BaseModel, EmailStr
from typing import Optional, Dict, List, Any
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import logging
import json
import os
import base64
import uuid
import hmac
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from scraper_poc import scrape_dns
from doc_generator import generate_tz_document
from database import engine, get_db, Base
from models import User, TZDocument, IntegrationEventLog, TenantSubscription
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, get_optional_user
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SUPERADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL", "").strip().lower()
SUPERADMIN_TENANT_ID = os.getenv("SUPERADMIN_TENANT_ID", "root")
YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID", "").strip()
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
YOOKASSA_RETURN_URL = os.getenv("YOOKASSA_RETURN_URL", "").strip() or "https://tz-generator-frontend.onrender.com"
YOOKASSA_WEBHOOK_SECRET = os.getenv("YOOKASSA_WEBHOOK_SECRET", "").strip()
INTEGRATION_API_TOKEN = (
    os.getenv("INTEGRATION_API_TOKEN", "").strip()
    or os.getenv("BACKEND_API_TOKEN", "").strip()
    or os.getenv("TZ_BACKEND_API_TOKEN", "").strip()
)
AI_PROXY_API_TOKEN = (
    os.getenv("AI_PROXY_API_TOKEN", "").strip()
    or INTEGRATION_API_TOKEN
)
AI_PROXY_TIMEOUT = float(os.getenv("AI_PROXY_TIMEOUT", "45"))
AI_PROXY_OPENROUTER_API_KEY = (
    os.getenv("AI_PROXY_OPENROUTER_API_KEY", "").strip()
    or os.getenv("OPENROUTER_API_KEY", "").strip()
)
AI_PROXY_GROQ_API_KEY = (
    os.getenv("AI_PROXY_GROQ_API_KEY", "").strip()
    or os.getenv("GROQ_API_KEY", "").strip()
)
AI_PROXY_DEEPSEEK_API_KEY = (
    os.getenv("AI_PROXY_DEEPSEEK_API_KEY", "").strip()
    or os.getenv("DEEPSEEK_API_KEY", "").strip()
)
OPENROUTER_REFERER = os.getenv("OPENROUTER_REFERER", "").strip() or "https://weerowoolf.pythonanywhere.com"
OPENROUTER_TITLE = os.getenv("OPENROUTER_TITLE", "TZ Generator").strip()


def _parse_cors_origins(raw: str) -> list[str]:
    text = (raw or "").strip()
    if text:
        return [item.strip() for item in text.split(",") if item.strip()]
    return [
        "https://weerowoolf.pythonanywhere.com",
        "https://tz-generator-frontend.onrender.com",
        "https://tz-generator-frontend-new.onrender.com",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]


CORS_ALLOW_ORIGINS = _parse_cors_origins(os.getenv("CORS_ALLOW_ORIGINS", ""))

PLAN_CATALOG: dict[str, dict[str, int]] = {
    "starter": {"price_cents": 19900, "users_limit": 3, "docs_month_limit": 100},
    "pro": {"price_cents": 49900, "users_limit": 15, "docs_month_limit": 1500},
    "enterprise": {"price_cents": 149900, "users_limit": 200, "docs_month_limit": 20000},
}

# Create tables
Base.metadata.create_all(bind=engine)


def _has_column(db: Session, table_name: str, column_name: str) -> bool:
    url = str(engine.url)
    if "sqlite" in url:
        rows = db.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        return any(str(r[1]) == column_name for r in rows)
    rows = db.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :col"
        ),
        {"table": table_name, "col": column_name},
    ).fetchall()
    return len(rows) > 0


def ensure_rbac_schema() -> None:
    with Session(bind=engine) as db:
        if not _has_column(db, "users", "tenant_id"):
            db.execute(text("ALTER TABLE users ADD COLUMN tenant_id VARCHAR DEFAULT 'default'"))
        if not _has_column(db, "users", "role"):
            db.execute(text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'manager'"))
        if not _has_column(db, "tz_documents", "tenant_id"):
            db.execute(text("ALTER TABLE tz_documents ADD COLUMN tenant_id VARCHAR DEFAULT 'default'"))
        db.execute(text("UPDATE users SET tenant_id = COALESCE(tenant_id, 'default')"))
        db.execute(text("UPDATE users SET role = COALESCE(role, 'manager')"))
        db.execute(text("UPDATE tz_documents SET tenant_id = COALESCE(tenant_id, 'default')"))
        db.commit()


ensure_rbac_schema()

app = FastAPI()
os.makedirs("temp", exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS if CORS_ALLOW_ORIGINS else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ──

class ProductRequest(BaseModel):
    product_name: str

class ProductResponse(BaseModel):
    product_name: str
    specs: Any = {}
    source: str = "dns-shop"

class DocumentMetadata(BaseModel):
    product_title: str = "оборудование"
    zakazchik: str = ""
    quantity: int = 1
    quantity_text: str = ""

class GenerateRequest(BaseModel):
    metadata: DocumentMetadata = DocumentMetadata()
    products: List[ProductResponse] = []

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    tenant_id: Optional[str] = ""

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token: str
    user: dict


class TenantUserUpdateRequest(BaseModel):
    user_id: int
    role: str

class SaveDocumentRequest(BaseModel):
    title: str
    metadata: DocumentMetadata = DocumentMetadata()
    products: List[ProductResponse] = []

class DocumentOut(BaseModel):
    id: int
    title: str
    metadata: dict
    products: list
    created_at: str
    updated_at: str


class TenantKpiOut(BaseModel):
    tenant_id: str
    users_total: int
    docs_total: int
    docs_last_30d: int
    estimated_revenue_cents: int


class TenantSubscriptionUpdateRequest(BaseModel):
    plan_code: str
    monthly_price_cents: int = 19900
    status: str = "active"
    billing_cycle: str = "monthly"


class IntegrationEventIn(BaseModel):
    kind: str = "integration.event"
    source: str = "react"
    payload: Dict[str, Any] = {}
    idempotency_key: str = ""


class YooKassaCheckoutIn(BaseModel):
    plan_code: str
    return_url: Optional[str] = ""

class OpenRouterModelsIn(BaseModel):
    api_key: str

class BillingReadinessOut(BaseModel):
    ok: bool
    provider: str
    ready_for_checkout: bool
    return_url: str
    webhook_path: str
    configured: Dict[str, bool]
    next_steps: List[str]


class AIMessageIn(BaseModel):
    role: str
    content: Any
    name: Optional[str] = None


class AIChatIn(BaseModel):
    provider: str
    model: str
    messages: List[AIMessageIn]
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    timeout_sec: Optional[float] = None
    api_key: str = ""
    extra: Dict[str, Any] = {}


def _can_access_doc(user: User, doc: TZDocument) -> bool:
    if doc.tenant_id != user.tenant_id:
        return False
    if user.role in ("superadmin", "admin", "manager"):
        return True
    return doc.user_id == user.id


def _can_manage_tenant(user: User) -> bool:
    return user.role in ("superadmin", "admin", "manager")


def _is_superadmin(user: User) -> bool:
    role = str(getattr(user, "role", "")).lower()
    email = str(getattr(user, "email", "")).lower()
    return role == "superadmin" or (SUPERADMIN_EMAIL and email == SUPERADMIN_EMAIL)


def _plan_info(plan_code: str) -> dict[str, int]:
    code = (plan_code or "starter").strip().lower()
    return PLAN_CATALOG.get(code, PLAN_CATALOG["starter"])


def _month_start_utc(now: Optional[datetime] = None) -> datetime:
    dt = now or datetime.now(timezone.utc)
    return datetime(dt.year, dt.month, 1, tzinfo=timezone.utc)


def _ensure_subscription(db: Session, tenant_id: str) -> TenantSubscription:
    sub = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant_id).first()
    if sub:
        return sub
    info = _plan_info("starter")
    sub = TenantSubscription(tenant_id=tenant_id, plan_code="starter", monthly_price_cents=info["price_cents"])
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def _enforce_users_limit(db: Session, tenant_id: str) -> None:
    sub = _ensure_subscription(db, tenant_id)
    info = _plan_info(sub.plan_code)
    users_total = db.query(User).filter(User.tenant_id == tenant_id).count()
    if users_total >= info["users_limit"]:
        raise HTTPException(
            status_code=402,
            detail=f"Лимит пользователей по плану {sub.plan_code}: {info['users_limit']}. Нужен апгрейд.",
        )


def _enforce_docs_limit(db: Session, tenant_id: str) -> None:
    sub = _ensure_subscription(db, tenant_id)
    info = _plan_info(sub.plan_code)
    start = _month_start_utc()
    docs_month = db.query(TZDocument).filter(
        TZDocument.tenant_id == tenant_id,
        TZDocument.created_at >= start,
    ).count()
    if docs_month >= info["docs_month_limit"]:
        raise HTTPException(
            status_code=402,
            detail=f"Лимит документов в месяц по плану {sub.plan_code}: {info['docs_month_limit']}. Нужен апгрейд.",
        )


def _log_integration_event(db: Session, tenant_id: str, user_id: Optional[int], event_name: str, payload: Dict[str, Any]) -> None:
    row = IntegrationEventLog(
        tenant_id=tenant_id,
        user_id=user_id,
        event_name=(event_name or "integration.event")[:180],
        payload_json=json.dumps(payload or {}, ensure_ascii=False),
    )
    db.add(row)
    db.commit()

def _yookassa_shop_id() -> str:
    return os.getenv("YOOKASSA_SHOP_ID", "").strip() or YOOKASSA_SHOP_ID


def _yookassa_secret_key() -> str:
    return os.getenv("YOOKASSA_SECRET_KEY", "").strip() or YOOKASSA_SECRET_KEY


def _yookassa_return_url() -> str:
    return os.getenv("YOOKASSA_RETURN_URL", "").strip() or YOOKASSA_RETURN_URL


def _yookassa_webhook_secret() -> str:
    return os.getenv("YOOKASSA_WEBHOOK_SECRET", "").strip() or YOOKASSA_WEBHOOK_SECRET


def _yookassa_headers(idempotence_key: str) -> dict[str, str]:
    auth = base64.b64encode(f"{_yookassa_shop_id()}:{_yookassa_secret_key()}".encode("utf-8")).decode("ascii")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Basic {auth}",
        "Idempotence-Key": idempotence_key,
    }


def _create_yookassa_payment(payload: Dict[str, Any], idempotence_key: str) -> Dict[str, Any]:
    if not _yookassa_shop_id() or not _yookassa_secret_key():
        raise HTTPException(status_code=400, detail="YOOKASSA credentials are not configured")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        "https://api.yookassa.ru/v3/payments",
        data=body,
        headers=_yookassa_headers(idempotence_key),
        method="POST",
    )
    try:
        with urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore") if hasattr(err, "read") else str(err)
        raise HTTPException(status_code=502, detail=f"yookassa_http_{err.code}: {detail[:240]}")
    except URLError as err:
        raise HTTPException(status_code=502, detail=f"yookassa_url_error: {err.reason}")
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"yookassa_error: {str(err)[:240]}")


def _openrouter_models(api_key: str) -> list[dict[str, Any]]:
    clean = str(api_key or "").strip().replace("Bearer ", "", 1).strip()
    if len(clean) < 10:
        raise HTTPException(status_code=400, detail="api_key_required")
    req = Request(
        "https://openrouter.ai/api/v1/models",
        headers={
            "Authorization": f"Bearer {clean}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://tz-generator-frontend.onrender.com",
            "X-Title": "TZ Generator React",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=25) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            items = data.get("data") if isinstance(data, dict) else []
            if not isinstance(items, list):
                return []
            out: list[dict[str, Any]] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                model_id = str(item.get("id", "")).strip()
                if not model_id:
                    continue
                out.append(
                    {
                        "id": model_id,
                        "name": str(item.get("name", "")).strip() or None,
                        "context_length": int(item.get("context_length", 0) or 0) or None,
                    }
                )
            out.sort(key=lambda x: x.get("id") or "")
            return out
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore") if hasattr(err, "read") else str(err)
        raise HTTPException(status_code=502, detail=f"openrouter_http_{err.code}: {detail[:240]}")
    except URLError as err:
        raise HTTPException(status_code=502, detail=f"openrouter_url_error: {err.reason}")
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"openrouter_error: {str(err)[:240]}")


def _extract_machine_token(request: FastAPIRequest) -> str:
    auth = str(request.headers.get("authorization", "")).strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return str(request.headers.get("x-api-token", "")).strip()


def _require_machine_token(request: FastAPIRequest) -> None:
    if not AI_PROXY_API_TOKEN:
        return
    token = _extract_machine_token(request)
    if token and hmac.compare_digest(token, AI_PROXY_API_TOKEN):
        return
    raise HTTPException(status_code=401, detail="ai_proxy_auth_required", headers={"WWW-Authenticate": "Bearer"})


def _ai_provider_config(provider: str) -> tuple[str, str]:
    p = str(provider or "").strip().lower()
    if p == "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions", AI_PROXY_OPENROUTER_API_KEY
    if p == "groq":
        return "https://api.groq.com/openai/v1/chat/completions", AI_PROXY_GROQ_API_KEY
    if p == "deepseek":
        return "https://api.deepseek.com/chat/completions", AI_PROXY_DEEPSEEK_API_KEY
    raise HTTPException(status_code=400, detail=f"unsupported_provider: {provider}")


def _proxy_ai_chat_completion(provider: str, payload: Dict[str, Any], body_api_key: str = "", timeout_sec: Optional[float] = None) -> Dict[str, Any]:
    upstream_url, env_key = _ai_provider_config(provider)
    api_key = (body_api_key or "").strip() or env_key
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider}_api_key_not_configured")

    timeout = float(timeout_sec or AI_PROXY_TIMEOUT)
    timeout = max(1.0, min(timeout, 120.0))
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if str(provider or "").strip().lower() == "openrouter":
        headers["HTTP-Referer"] = OPENROUTER_REFERER
        headers["X-Title"] = OPENROUTER_TITLE

    req = Request(upstream_url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            code = int(getattr(resp, "status", 200))
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
            return {"ok": 200 <= code < 300, "status_code": code, "data": data}
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore") if hasattr(err, "read") else str(err)
        raise HTTPException(status_code=502, detail=f"ai_proxy_http_{err.code}: {detail[:400]}")
    except URLError as err:
        raise HTTPException(status_code=502, detail=f"ai_proxy_url_error: {err.reason}")
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"ai_proxy_error: {str(err)[:400]}")


# ── Core Endpoints ──

@app.get("/")
def read_root():
    return {"message": "ТЗ Generator API is running"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "tz-generator-backend",
        "integration_auth_configured": bool(INTEGRATION_API_TOKEN),
        "ai_proxy_auth_configured": bool(AI_PROXY_API_TOKEN),
        "ai_proxy_configured_providers": [
            name
            for name, ready in (
                ("openrouter", bool(AI_PROXY_OPENROUTER_API_KEY)),
                ("groq", bool(AI_PROXY_GROQ_API_KEY)),
                ("deepseek", bool(AI_PROXY_DEEPSEEK_API_KEY)),
            )
            if ready
        ],
        "cors_allow_origins": CORS_ALLOW_ORIGINS,
    }


@app.get("/api/v1/ping")
def api_ping():
    return {"message": "pong"}


@app.post("/api/scrape", response_model=ProductResponse)
async def scrape_product(request: ProductRequest):
    logger.info(f"Scrape request: {request.product_name}")
    try:
        specs = await scrape_dns(request.product_name)
        if not specs:
            return ProductResponse(
                product_name=request.product_name,
                specs=[{"group": "Ошибка", "specs": [{"name": "Статус", "value": "Данные не найдены"}]}]
            )
        return ProductResponse(product_name=request.product_name, specs=specs)
    except Exception as e:
        logger.error(f"Scrape error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/generate")
async def generate_document(request: GenerateRequest):
    logger.info(f"Generating doc for {len(request.products)} products")
    try:
        products_data = [p.dict() for p in request.products]
        metadata = request.metadata.dict()
        template_path = "base_template.docx"
        output_path = os.path.join("temp", "generated_tz.docx")

        if not os.path.exists(template_path):
            from create_template import create_base_template
            create_base_template()

        generate_tz_document(template_path, output_path, products_data, metadata)
        return FileResponse(
            path=output_path,
            filename="generated_tz.docx",
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    except Exception as e:
        logger.error(f"Generate error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Auth Endpoints ──

@app.post("/api/auth/register", response_model=AuthResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    users_count = db.query(User).count()
    requested_tenant = (req.tenant_id or "").strip() or "default"
    is_superadmin_signup = bool(SUPERADMIN_EMAIL and req.email.strip().lower() == SUPERADMIN_EMAIL)
    tenant_id = SUPERADMIN_TENANT_ID if is_superadmin_signup else requested_tenant
    role = "superadmin" if is_superadmin_signup else ("admin" if users_count == 0 else "manager")
    if not is_superadmin_signup and users_count > 0:
        _enforce_users_limit(db, tenant_id)
    user = User(
        email=req.email,
        name=req.name,
        tenant_id=tenant_id,
        role=role,
        hashed_password=hash_password(req.password)
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "name": user.name, "tenant_id": user.tenant_id, "role": user.role}
    )


@app.post("/api/auth/login", response_model=AuthResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    token = create_access_token({"sub": str(user.id)})
    return AuthResponse(
        token=token,
        user={"id": user.id, "email": user.email, "name": user.name, "tenant_id": user.tenant_id, "role": user.role}
    )


@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "tenant_id": user.tenant_id, "role": user.role}


# ── Document CRUD ──

@app.post("/api/documents", response_model=DocumentOut)
def save_document(req: SaveDocumentRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _is_superadmin(user):
        _enforce_docs_limit(db, user.tenant_id)
    doc = TZDocument(
        user_id=user.id,
        tenant_id=user.tenant_id,
        title=req.title,
        metadata_json=json.dumps(req.metadata.dict(), ensure_ascii=False),
        products_json=json.dumps([p.dict() for p in req.products], ensure_ascii=False),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _doc_to_out(doc)


@app.get("/api/documents", response_model=List[DocumentOut])
def list_documents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if _is_superadmin(user):
        docs = db.query(TZDocument).order_by(TZDocument.updated_at.desc()).all()
    elif user.role in ("admin", "manager"):
        docs = (
            db.query(TZDocument)
            .filter(TZDocument.tenant_id == user.tenant_id)
            .order_by(TZDocument.updated_at.desc())
            .all()
        )
    else:
        docs = (
            db.query(TZDocument)
            .filter(TZDocument.tenant_id == user.tenant_id, TZDocument.user_id == user.id)
            .order_by(TZDocument.updated_at.desc())
            .all()
        )
    return [_doc_to_out(d) for d in docs]


@app.get("/api/documents/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(TZDocument).filter(TZDocument.id == doc_id).first()
    if not doc or not _can_access_doc(user, doc):
        raise HTTPException(status_code=404, detail="Документ не найден")
    return _doc_to_out(doc)


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(TZDocument).filter(TZDocument.id == doc_id).first()
    if not doc or not _can_access_doc(user, doc):
        raise HTTPException(status_code=404, detail="Документ не найден")
    if user.role == "viewer" and doc.user_id != user.id:
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    db.delete(doc)
    db.commit()
    return {"ok": True}


@app.get("/api/tenant/users")
def list_tenant_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    users = (
        db.query(User)
        .filter(User.tenant_id == user.tenant_id)
        .order_by(User.created_at.asc())
        .all()
    )
    return {
        "ok": True,
        "items": [
            {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "tenant_id": u.tenant_id}
            for u in users
        ],
    }


@app.post("/api/tenant/users/role")
def update_tenant_user_role(
    req: TenantUserUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("superadmin", "admin"):
        raise HTTPException(status_code=403, detail="Только admin может менять роли")
    role = (req.role or "").strip().lower()
    if role not in ("superadmin", "admin", "manager", "viewer"):
        raise HTTPException(status_code=400, detail="Неверная роль")
    target = db.query(User).filter(User.id == req.user_id, User.tenant_id == user.tenant_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    target.role = role
    db.commit()
    return {"ok": True, "user_id": target.id, "role": target.role}


@app.get("/api/tenant/kpi", response_model=TenantKpiOut)
def tenant_kpi(
    billing_price_per_doc_cents: int = 9900,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    now = datetime.now(timezone.utc)
    dt_30 = now - timedelta(days=30)
    users_total = db.query(User).filter(User.tenant_id == user.tenant_id).count()
    docs_total = db.query(TZDocument).filter(TZDocument.tenant_id == user.tenant_id).count()
    docs_last_30d = (
        db.query(TZDocument)
        .filter(TZDocument.tenant_id == user.tenant_id, TZDocument.created_at >= dt_30)
        .count()
    )
    return TenantKpiOut(
        tenant_id=user.tenant_id,
        users_total=users_total,
        docs_total=docs_total,
        docs_last_30d=docs_last_30d,
        estimated_revenue_cents=max(0, int(billing_price_per_doc_cents)) * docs_last_30d,
    )


@app.get("/api/tenant/subscription")
def tenant_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    sub = _ensure_subscription(db, user.tenant_id)
    return {
        "ok": True,
        "subscription": {
            "tenant_id": sub.tenant_id,
            "plan_code": sub.plan_code,
            "status": sub.status,
            "monthly_price_cents": sub.monthly_price_cents,
            "billing_cycle": sub.billing_cycle,
            "next_billing_at": sub.next_billing_at.isoformat() if sub.next_billing_at else "",
        },
    }


@app.post("/api/tenant/subscription/update")
def tenant_subscription_update(
    req: TenantSubscriptionUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role not in ("superadmin", "admin"):
        raise HTTPException(status_code=403, detail="Только admin может менять подписку")
    if req.plan_code.strip().lower() not in ("starter", "pro", "enterprise"):
        raise HTTPException(status_code=400, detail="Неверный план")
    sub = _ensure_subscription(db, user.tenant_id)
    plan_code = req.plan_code.strip().lower()
    info = _plan_info(plan_code)
    sub.plan_code = plan_code
    sub.monthly_price_cents = max(0, int(req.monthly_price_cents or info["price_cents"]))
    sub.status = req.status.strip().lower() or "active"
    sub.billing_cycle = req.billing_cycle.strip().lower() or "monthly"
    db.commit()
    return {
        "ok": True,
        "plan_code": sub.plan_code,
        "monthly_price_cents": sub.monthly_price_cents,
        "limits": {
            "users_limit": info["users_limit"],
            "docs_month_limit": info["docs_month_limit"],
        },
    }


@app.post("/api/v1/integration/event")
def integration_event(body: IntegrationEventIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _log_integration_event(db, user.tenant_id, user.id, body.kind or "integration.event", body.payload or {})
    last = db.query(IntegrationEventLog).order_by(IntegrationEventLog.id.desc()).first()
    return {"ok": True, "id": last.id if last else None}


@app.get("/api/v1/integration/metrics")
def integration_metrics(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    now = datetime.now(timezone.utc)
    dt_24 = now - timedelta(hours=24)
    dt_1h = now - timedelta(hours=1)
    q = db.query(IntegrationEventLog).filter(
        IntegrationEventLog.tenant_id == user.tenant_id, IntegrationEventLog.created_at >= dt_24
    )
    events = q.all()
    sent = len(events)
    failed = sum(1 for e in events if ".failed" in (e.event_name or "").lower())
    recent = db.query(IntegrationEventLog).filter(
        IntegrationEventLog.tenant_id == user.tenant_id, IntegrationEventLog.created_at >= dt_1h
    ).count()
    status = "ok" if failed == 0 else "degraded"
    return {
        "ok": True,
        "metrics": {
            "status": status,
            "queue_total": 0,
            "history_total": sent,
            "dead_letter_total": failed,
            "oldest_queued_seconds": 0,
            "flush_24h": {"sent": sent, "queued": recent, "dead_letter": failed},
            "target_webhook_configured": True,
            "integration_auth_enabled": True,
            "integration_max_attempts": 1,
        },
        "at": now.isoformat(),
    }


@app.get("/api/tenant/billing/summary")
def tenant_billing_summary(
    price_per_doc_cents: int = 9900,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    sub = _ensure_subscription(db, user.tenant_id)
    info = _plan_info(sub.plan_code)
    dt_30 = datetime.now(timezone.utc) - timedelta(days=30)
    docs_30d = db.query(TZDocument).filter(TZDocument.tenant_id == user.tenant_id, TZDocument.created_at >= dt_30).count()
    usage_events_30d = db.query(IntegrationEventLog).filter(
        IntegrationEventLog.tenant_id == user.tenant_id,
        IntegrationEventLog.created_at >= dt_30,
        IntegrationEventLog.event_name == "billing.usage",
    ).count()
    metered_docs = max(docs_30d, usage_events_30d)
    return {
        "ok": True,
        "tenant_id": user.tenant_id,
        "subscription": {
            "plan_code": sub.plan_code,
            "status": sub.status,
            "monthly_price_cents": sub.monthly_price_cents,
            "billing_cycle": sub.billing_cycle,
            "users_limit": info["users_limit"],
            "docs_month_limit": info["docs_month_limit"],
        },
        "usage_30d_docs": metered_docs,
        "estimated_metered_revenue_cents": metered_docs * max(0, int(price_per_doc_cents)),
    }


@app.get("/api/tenant/alerts")
def tenant_alerts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    alerts: list[dict[str, str]] = []
    now = datetime.now(timezone.utc)
    dt_7 = now - timedelta(days=7)
    docs_7d = db.query(TZDocument).filter(TZDocument.tenant_id == user.tenant_id, TZDocument.created_at >= dt_7).count()
    if docs_7d == 0:
        alerts.append({"level": "warn", "code": "NO_ACTIVITY_7D", "message": "Нет документов за последние 7 дней."})
    failures_24h = db.query(IntegrationEventLog).filter(
        IntegrationEventLog.tenant_id == user.tenant_id,
        IntegrationEventLog.created_at >= (now - timedelta(hours=24)),
        IntegrationEventLog.event_name.like("%.failed%"),
    ).count()
    if failures_24h > 0:
        alerts.append(
            {
                "level": "critical" if failures_24h >= 5 else "warn",
                "code": "INTEGRATION_FAILURES_24H",
                "message": f"Ошибок интеграции за 24ч: {failures_24h}.",
            }
        )
    if not alerts:
        alerts.append({"level": "ok", "code": "ALL_GREEN", "message": "Критичных сигналов нет."})
    return {"ok": True, "tenant_id": user.tenant_id, "items": alerts}


@app.get("/api/tenant/plan/limits")
def tenant_plan_limits(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = _ensure_subscription(db, user.tenant_id)
    info = _plan_info(sub.plan_code)
    docs_month = db.query(TZDocument).filter(
        TZDocument.tenant_id == user.tenant_id,
        TZDocument.created_at >= _month_start_utc(),
    ).count()
    users_total = db.query(User).filter(User.tenant_id == user.tenant_id).count()
    return {
        "ok": True,
        "tenant_id": user.tenant_id,
        "plan_code": sub.plan_code,
        "limits": info,
        "usage": {"users_total": users_total, "docs_month_total": docs_month},
        "unlimited": _is_superadmin(user),
    }


@app.get("/api/v1/ai/providers")
def ai_providers(request: FastAPIRequest):
    _require_machine_token(request)
    return {
        "ok": True,
        "providers": {
            "openrouter": {"configured": bool(AI_PROXY_OPENROUTER_API_KEY)},
            "groq": {"configured": bool(AI_PROXY_GROQ_API_KEY)},
            "deepseek": {"configured": bool(AI_PROXY_DEEPSEEK_API_KEY)},
        },
        "auth_required": bool(AI_PROXY_API_TOKEN),
        "timeout_sec_default": AI_PROXY_TIMEOUT,
    }


@app.post("/api/v1/ai/chat")
def ai_chat(req: AIChatIn, request: FastAPIRequest):
    _require_machine_token(request)
    provider = (req.provider or "").strip().lower()
    payload: Dict[str, Any] = {
        "model": (req.model or "").strip(),
        "messages": [
            {k: v for k, v in {"role": m.role, "content": m.content, "name": m.name}.items() if v is not None}
            for m in (req.messages or [])
        ],
        "stream": False,
    }
    if req.temperature is not None:
        payload["temperature"] = req.temperature
    if req.max_tokens is not None:
        payload["max_tokens"] = req.max_tokens
    for k, v in (req.extra or {}).items():
        if not isinstance(k, str):
            continue
        key = k.strip()
        if not key or key in {"provider", "model", "messages", "stream", "api_key"}:
            continue
        payload[key] = v

    upstream = _proxy_ai_chat_completion(provider, payload, body_api_key=req.api_key, timeout_sec=req.timeout_sec)
    logger.info(
        "ai_proxy provider=%s model=%s status=%s",
        provider,
        (req.model or "")[:80],
        upstream.get("status_code"),
    )
    return {"ok": True, "provider": provider, **upstream}

@app.post("/api/public/openrouter/models")
def public_openrouter_models(req: OpenRouterModelsIn):
    return {"ok": True, "items": _openrouter_models(req.api_key)}

@app.get("/api/public/billing/readiness", response_model=BillingReadinessOut)
def public_billing_readiness():
    current_return_url = _yookassa_return_url()
    has_shop = bool(_yookassa_shop_id())
    has_secret = bool(_yookassa_secret_key())
    has_return = bool(current_return_url)
    has_webhook_secret = bool(_yookassa_webhook_secret())
    next_steps: list[str] = []
    if not has_shop:
        next_steps.append("Укажите YOOKASSA_SHOP_ID в backend env.")
    if not has_secret:
        next_steps.append("Укажите YOOKASSA_SECRET_KEY в backend env.")
    if not has_return:
        next_steps.append("Укажите YOOKASSA_RETURN_URL в backend env.")
    if not has_webhook_secret:
        next_steps.append("Укажите YOOKASSA_WEBHOOK_SECRET в backend env и в настройках webhook YooKassa.")
    if not next_steps:
        next_steps.append("Billing готов: можно проводить checkout и webhook подтверждение.")
    return {
        "ok": True,
        "provider": "yookassa",
        "ready_for_checkout": has_shop and has_secret,
        "return_url": current_return_url,
        "webhook_path": "/api/tenant/payments/yookassa/webhook",
        "configured": {
            "shop_id": has_shop,
            "secret_key": has_secret,
            "return_url": has_return,
            "webhook_secret": has_webhook_secret,
        },
        "next_steps": next_steps,
    }


@app.post("/api/tenant/payments/yookassa/checkout")
def yookassa_checkout(
    req: YooKassaCheckoutIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _can_manage_tenant(user):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    plan_code = (req.plan_code or "").strip().lower()
    if plan_code not in PLAN_CATALOG:
        raise HTTPException(status_code=400, detail="Неверный план")
    info = _plan_info(plan_code)
    payload = {
        "amount": {"value": f"{info['price_cents'] / 100:.2f}", "currency": "RUB"},
        "capture": True,
        "confirmation": {"type": "redirect", "return_url": (req.return_url or "").strip() or _yookassa_return_url()},
        "description": f"TZ Generator plan {plan_code}",
        "metadata": {"tenant_id": user.tenant_id, "plan_code": plan_code, "requested_by_user_id": str(user.id)},
    }
    payment = _create_yookassa_payment(payload, idempotence_key=str(uuid.uuid4()))
    _log_integration_event(
        db,
        user.tenant_id,
        user.id,
        "payment.yookassa.checkout_created",
        {"plan_code": plan_code, "payment_id": payment.get("id", "")},
    )
    return {
        "ok": True,
        "plan_code": plan_code,
        "payment_id": payment.get("id", ""),
        "status": payment.get("status", ""),
        "confirmation_url": ((payment.get("confirmation") or {}).get("confirmation_url") if isinstance(payment, dict) else ""),
    }


@app.post("/api/tenant/payments/yookassa/webhook")
async def yookassa_webhook(payload: Dict[str, Any], db: Session = Depends(get_db)):
    webhook_secret = _yookassa_webhook_secret()
    if webhook_secret:
        token = str(payload.get("webhook_secret", "")).strip()
        if token != webhook_secret:
            raise HTTPException(status_code=401, detail="invalid webhook secret")

    event = str(payload.get("event", "")).strip().lower()
    obj = payload.get("object") if isinstance(payload.get("object"), dict) else {}
    status = str(obj.get("status", "")).strip().lower()
    metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
    tenant_id = str(metadata.get("tenant_id", "")).strip() or "default"
    plan_code = str(metadata.get("plan_code", "")).strip().lower()

    if event == "payment.succeeded" and status == "succeeded" and plan_code in PLAN_CATALOG:
        sub = _ensure_subscription(db, tenant_id)
        info = _plan_info(plan_code)
        sub.plan_code = plan_code
        sub.monthly_price_cents = info["price_cents"]
        sub.status = "active"
        db.commit()
        _log_integration_event(
            db,
            tenant_id,
            None,
            "payment.yookassa.succeeded",
            {"plan_code": plan_code, "payment_id": obj.get("id", "")},
        )
        return {"ok": True, "updated": True, "tenant_id": tenant_id, "plan_code": plan_code}

    return {"ok": True, "updated": False}


def _doc_to_out(doc: TZDocument) -> DocumentOut:
    return DocumentOut(
        id=doc.id,
        title=doc.title,
        metadata=json.loads(doc.metadata_json),
        products=json.loads(doc.products_json),
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )
