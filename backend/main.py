"""
TZ Generator — FastAPI backend
Endpoints:
  POST /api/auth/login          — login with username/password (super admin)
  POST /api/auth/send-link      — send magic link to email
  GET  /api/auth/verify         — verify token, return JWT
  GET  /api/auth/me             — get current user info
  POST /api/ai/generate         — proxy AI (DeepSeek/Groq/OpenRouter, no user key needed)
  POST /api/search/specs        — Serper.dev → product specs
  POST /api/search/eis          — EIS zakupki.gov.ru → TZ specs
  POST /api/payment/create      — create YooKassa payment
  POST /api/payment/webhook     — YooKassa webhook
  GET  /health                  — health check
"""
import os
import json
import uuid
import hmac
import base64
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError, URLError

import re as _re

from fastapi import FastAPI, HTTPException, Depends, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

# Package-safe imports (works for both `uvicorn backend.main:app` and `uvicorn main:app`)
try:
    from .database import (  # type: ignore
        get_db,
        init_db,
        SessionLocal,
        User,
        MagicToken,
        TZDocument,
        IntegrationState,
        IntegrationAuditLog,
        IntegrationIdempotencyKey,
        ImmutableAuditChain,
    )
    from .auth import (  # type: ignore
        send_magic_link,
        create_magic_token,
        verify_magic_token,
        get_or_create_user,
        create_jwt,
        decode_jwt,
        sync_user_entitlements,
        authenticate_superadmin,
        is_trial_active,
        is_payment_required,
        payment_required_message,
        trial_days_left,
        JWT_SECRET,
        SMTP_USER,
        SMTP_PASS,
    )
except ImportError:
    from database import (
        get_db,
        init_db,
        SessionLocal,
        User,
        MagicToken,
        TZDocument,
        IntegrationState,
        IntegrationAuditLog,
        IntegrationIdempotencyKey,
        ImmutableAuditChain,
    )
    from auth import (
        send_magic_link,
        create_magic_token,
        verify_magic_token,
        get_or_create_user,
        create_jwt,
        decode_jwt,
        sync_user_entitlements,
        authenticate_superadmin,
        is_trial_active,
        is_payment_required,
        payment_required_message,
        trial_days_left,
        JWT_SECRET,
        SMTP_USER,
        SMTP_PASS,
    )

# ── Search module ──────────────────────────────────────────────
_search_import_source = "stub"
try:
    from .search import (  # type: ignore
        search_internet_specs,
        search_eis_specs,
        _has_sufficient_exact_model_quality,
        _looks_like_specific_model_query,
        _resolve_msi_exact_model_specs,
    )
    _search_import_source = "package"
except ImportError:
    try:
        from search import (
            search_internet_specs,
            search_eis_specs,
            _has_sufficient_exact_model_quality,
            _looks_like_specific_model_query,
            _resolve_msi_exact_model_specs,
        )
        _search_import_source = "direct"
    except Exception as _search_err:
        import traceback
        print(f"WARNING: search module import failed: {_search_err}")
        traceback.print_exc()
        async def search_internet_specs(product: str, goods_type: str) -> list:  # type: ignore
            return []
        async def search_eis_specs(query: str, goods_type: str) -> list:  # type: ignore
            return []
        def _has_sufficient_exact_model_quality(specs: list) -> bool:  # type: ignore
            return False
        def _looks_like_specific_model_query(query: str) -> bool:  # type: ignore
            return False
        def _resolve_msi_exact_model_specs(product: str, goods_type: str = "") -> list:  # type: ignore
            return []

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Env config ─────────────────────────────────────────────────
DEEPSEEK_API_KEY    = os.getenv("DEEPSEEK_API_KEY", "").strip()
GROQ_API_KEY        = os.getenv("GROQ_API_KEY", "").strip()
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "").strip()

YOOKASSA_SHOP_ID       = os.getenv("YOOKASSA_SHOP_ID", "").strip()
YOOKASSA_SECRET_KEY    = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
YOOKASSA_RETURN_URL    = os.getenv("YOOKASSA_RETURN_URL", "https://arharius.github.io/testzak/").strip()
YOOKASSA_WEBHOOK_SECRET = os.getenv("YOOKASSA_WEBHOOK_SECRET", "").strip()

AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "100"))

FREE_TZ_LIMIT = max(0, int(os.getenv("FREE_TZ_LIMIT", "0")))

# ── Integration / Enterprise automation env ───────────────────
INTEGRATION_TARGET_WEBHOOK_URL = os.getenv("INTEGRATION_TARGET_WEBHOOK_URL", "").strip()
INTEGRATION_TARGET_TIMEOUT = float(os.getenv("INTEGRATION_TARGET_TIMEOUT", "12"))
INTEGRATION_API_TOKEN = (
    os.getenv("INTEGRATION_API_TOKEN", "").strip()
    or os.getenv("BACKEND_API_TOKEN", "").strip()
    or os.getenv("TZ_BACKEND_API_TOKEN", "").strip()
)
INTEGRATION_ALLOW_ANON = os.getenv("INTEGRATION_ALLOW_ANON", "").strip().lower() in {"1", "true", "yes", "on"}
ENTERPRISE_HTTP_TIMEOUT = float(os.getenv("ENTERPRISE_HTTP_TIMEOUT", "20"))
ENTERPRISE_SIMULATION_MODE = os.getenv("ENTERPRISE_SIMULATION_MODE", "1").strip().lower() not in {"0", "false", "off", "no"}

_cors_raw = os.getenv("CORS_ALLOW_ORIGINS", "")
CORS_ORIGINS = [s.strip() for s in _cors_raw.split(",") if s.strip()] if _cors_raw else [
    "https://tz-generator.onrender.com",
    "https://tz-generator-frontend.onrender.com",
    "https://tz-generator-frontend-new.onrender.com",
    "https://arharius.github.io",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

# ── Rate limiter ───────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

# ── FastAPI app ─────────────────────────────────────────────────
app = FastAPI(title="TZ Generator API", version="3.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, lambda req, exc: JSONResponse(
    status_code=429,
    content={"detail": "Слишком много запросов. Подождите немного.", "retry_after": str(exc.detail)},
))
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# ── Global error handler ──────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {type(exc).__name__}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера. Попробуйте позже."},
    )

@app.middleware("http")
async def log_requests(request: Request, call_next):
    import time as _t
    start = _t.time()
    response = await call_next(request)
    elapsed = _t.time() - start
    if elapsed > 2.0:
        logger.warning(f"SLOW {request.method} {request.url.path} → {response.status_code} in {elapsed:.1f}s")
    return response

# ── Pydantic models ─────────────────────────────────────────────
_EMAIL_RE = _re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")

def _user_response(user: User) -> dict:
    """Build standardized user info dict for API responses."""
    payment_required = is_payment_required(user)
    return {
        "email": user.email,
        "role": user.role,
        "tz_count": user.tz_count,
        "tz_limit": user.tz_limit,
        "trial_active": is_trial_active(user),
        "trial_days_left": trial_days_left(user),
        "trial_ends_at": user.trial_ends_at.isoformat() if user.trial_ends_at else None,
        "payment_required": payment_required,
        "access_tier": (
            "admin"
            if user.role == "admin"
            else "pro"
            if user.role == "pro"
            else "trial"
            if is_trial_active(user)
            else "payment_required"
        ),
    }


class SendLinkRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Некорректный формат email")
        return v

class LoginRequest(BaseModel):
    username: str
    password: str

class VerifyTokenRequest(BaseModel):
    token: str

class AIGenerateRequest(BaseModel):
    provider: str = "deepseek"
    model: str = "deepseek-chat"
    messages: list[dict]
    temperature: Optional[float] = 0.3
    max_tokens: Optional[int] = 4096

class SearchSpecsRequest(BaseModel):
    product: str          # e.g. "Acer Veriton X2690G системный блок"
    goods_type: str = ""  # e.g. "pc"

class SearchEisRequest(BaseModel):
    query: str            # e.g. "системный блок"
    goods_type: str = ""

class PaymentCreateRequest(BaseModel):
    plan: str = "pro"     # pro / annual
    return_url: Optional[str] = None


class IntegrationEventIn(BaseModel):
    kind: str = Field(default="integration.event", min_length=3, max_length=120)
    source: str = Field(default="ui", min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(default="", max_length=180)


class IntegrationFlushIn(BaseModel):
    limit: int = Field(default=100, ge=1, le=500)


class IntegrationAuditIn(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)


class EnterpriseAutopilotIn(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    procedure_id: str = Field(default="", max_length=240)
    idempotency_key: str = Field(default="", max_length=180)

# ── Auth helpers ────────────────────────────────────────────────
def _get_token_from_header(authorization: Optional[str] = Header(default=None)) -> Optional[str]:
    if not authorization:
        return None
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return authorization.strip()

def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = None
    if authorization:
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else authorization.strip()
    if not token:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    payload = decode_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Неверный или истёкший токен")
    email = payload.get("sub", "")
    user = db.query(User).filter_by(email=email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    if sync_user_entitlements(user):
        db.commit()
    return user

def get_optional_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[User]:
    try:
        return get_current_user(authorization, db)
    except HTTPException:
        return None

def require_active(user: User, db=None) -> None:
    """Check that user can generate TZ (not over limit)."""
    if user.role == "admin":
        return  # unlimited
    if is_payment_required(user):
        raise HTTPException(status_code=402, detail=payment_required_message(user))
    if user.tz_limit == -1:
        return  # explicitly unlimited (pro)
    if user.tz_limit <= 0:
        raise HTTPException(status_code=402, detail=payment_required_message(user))
    # Check monthly count — reset on new calendar month
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if hasattr(user, "tz_month_start") and user.tz_month_start:
        ms = user.tz_month_start
        if hasattr(ms, "replace") and ms.tzinfo is None:
            ms = ms.replace(tzinfo=timezone.utc)
        if ms < month_start:
            # New month — reset counter and persist
            user.tz_count = 0
            user.tz_month_start = month_start
            if db:
                db.commit()
    elif not user.tz_month_start:
        user.tz_month_start = month_start
        if db:
            db.commit()
    if user.tz_count >= user.tz_limit:
        raise HTTPException(
            status_code=402,
            detail=f"Достигнут лимит {user.tz_limit} ТЗ в месяц. Оформите подписку Pro для безлимитного доступа.",
        )


# ── Integration / Enterprise automation helpers ───────────────
def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_integration_store() -> dict[str, Any]:
    return {"queue": [], "history": [], "enterprise_status": []}


def _safe_json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            return []
    return []


def _ensure_integration_state(db: Session) -> IntegrationState:
    state = db.query(IntegrationState).filter_by(id=1).first()
    if state:
        return state
    state = IntegrationState(
        id=1,
        queue_json="[]",
        history_json="[]",
        enterprise_status_json="[]",
        updated_at=datetime.now(timezone.utc),
    )
    db.add(state)
    db.commit()
    db.refresh(state)
    return state


def _lock_integration_state(db: Session) -> IntegrationState:
    query = db.query(IntegrationState).filter_by(id=1)
    try:
        state = query.with_for_update().first()
    except Exception:
        state = query.first()
    if state:
        return state
    state = IntegrationState(
        id=1,
        queue_json="[]",
        history_json="[]",
        enterprise_status_json="[]",
        updated_at=datetime.now(timezone.utc),
    )
    db.add(state)
    db.flush()
    return state


def load_integration_store() -> dict[str, Any]:
    db = SessionLocal()
    try:
        state = _ensure_integration_state(db)
        return {
            "queue": _safe_json_list(state.queue_json),
            "history": _safe_json_list(state.history_json),
            "enterprise_status": _safe_json_list(state.enterprise_status_json),
        }
    except Exception:
        return _default_integration_store()
    finally:
        db.close()


def save_integration_store(data: dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        state = _ensure_integration_state(db)
        state.queue_json = json.dumps(_safe_json_list(data.get("queue", [])), ensure_ascii=False)
        state.history_json = json.dumps(_safe_json_list(data.get("history", [])), ensure_ascii=False)
        state.enterprise_status_json = json.dumps(_safe_json_list(data.get("enterprise_status", [])), ensure_ascii=False)
        state.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def init_integration_db() -> None:
    db = SessionLocal()
    try:
        _ensure_integration_state(db)
    finally:
        db.close()


def log_integration_audit(
    action: str,
    status: str,
    record_id: str = "",
    note: str = "",
    payload: dict[str, Any] | None = None
) -> None:
    db = SessionLocal()
    try:
        db.add(
            IntegrationAuditLog(
                at=utc_now(),
                action=action,
                status=status,
                record_id=record_id,
                note=note[:400],
                payload_json=json.dumps(payload or {}, ensure_ascii=False),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _get_idempotency_response(idem_key: str) -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        row = db.query(IntegrationIdempotencyKey).filter_by(idem_key=idem_key).first()
        if not row:
            return None
        return json.loads(row.response_json or "{}")
    except Exception:
        return None
    finally:
        db.close()


def _store_idempotency_response(idem_key: str, response: dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        row = db.query(IntegrationIdempotencyKey).filter_by(idem_key=idem_key).first()
        if not row:
            row = IntegrationIdempotencyKey(idem_key=idem_key, created_at=utc_now(), response_json="{}")
            db.add(row)
        row.created_at = utc_now()
        row.response_json = json.dumps(response, ensure_ascii=False)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _append_immutable_audit(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    at = utc_now()
    db = SessionLocal()
    try:
        prev_row = db.query(ImmutableAuditChain).order_by(ImmutableAuditChain.id.desc()).first()
        prev_hash = str(prev_row.hash) if prev_row else "genesis"
        payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        base = f"{at}|{action}|{payload_json}|{prev_hash}"
        digest = hashlib.sha256(base.encode("utf-8")).hexdigest()
        db.add(
            ImmutableAuditChain(
                at=at,
                action=action,
                payload_json=payload_json,
                prev_hash=prev_hash,
                hash=digest,
            )
        )
        db.commit()
        return {
            "at": at,
            "action": action,
            "prev_hash": prev_hash,
            "hash": digest,
        }
    finally:
        db.close()


def _extract_api_token(authorization: Optional[str], x_api_token: Optional[str]) -> str:
    auth = (authorization or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    if auth:
        return auth
    return (x_api_token or "").strip()


def require_integration_auth(authorization: Optional[str], x_api_token: Optional[str]) -> None:
    if not INTEGRATION_API_TOKEN:
        if INTEGRATION_ALLOW_ANON:
            return
        raise HTTPException(status_code=401, detail="integration_auth_required")
    got = _extract_api_token(authorization, x_api_token)
    if got and hmac.compare_digest(got, INTEGRATION_API_TOKEN):
        return
    raise HTTPException(status_code=401, detail="integration_auth_required")


def require_integration_access(
    user: Optional[User],
    authorization: Optional[str],
    x_api_token: Optional[str],
) -> str:
    if user is not None:
        return "user"
    require_integration_auth(authorization, x_api_token)
    return "integration_token"


def require_enterprise_access(
    user: Optional[User],
    authorization: Optional[str],
    x_api_token: Optional[str],
) -> str:
    if user is not None:
        return "user"
    require_integration_auth(authorization, x_api_token)
    return "integration_token"


def _normalize_bearer_token(token: str) -> str:
    text = str(token or "").strip()
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    return text


def _http_post_json(
    url: str,
    payload: dict[str, Any],
    token: str = "",
    extra_headers: dict[str, str] | None = None,
    timeout: float = ENTERPRISE_HTTP_TIMEOUT,
) -> tuple[bool, int, dict[str, Any]]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if extra_headers:
        headers.update({str(k): str(v) for k, v in extra_headers.items()})
    bearer = _normalize_bearer_token(token)
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = URLRequest(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            status = int(getattr(resp, "status", 200))
            text = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text) if text else {}
            except Exception:
                parsed = {"raw_text": text[:4000]}
            return (200 <= status < 300), status, parsed
    except HTTPError as err:
        try:
            text = err.read().decode("utf-8", errors="replace")
            parsed = json.loads(text) if text else {}
        except Exception:
            parsed = {"error": str(err)}
        return False, int(err.code), parsed
    except URLError as err:
        return False, 0, {"error": f"url_error: {err.reason}"}
    except Exception as err:
        return False, 0, {"error": str(err)}


def _http_get_json(
    url: str,
    token: str = "",
    extra_headers: dict[str, str] | None = None,
    timeout: float = ENTERPRISE_HTTP_TIMEOUT,
) -> tuple[bool, int, dict[str, Any]]:
    headers = {"Accept": "application/json"}
    if extra_headers:
        headers.update({str(k): str(v) for k, v in extra_headers.items()})
    bearer = _normalize_bearer_token(token)
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    req = URLRequest(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=timeout) as resp:
            status = int(getattr(resp, "status", 200))
            text = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text) if text else {}
            except Exception:
                parsed = {"raw_text": text[:4000]}
            return (200 <= status < 300), status, parsed
    except HTTPError as err:
        try:
            text = err.read().decode("utf-8", errors="replace")
            parsed = json.loads(text) if text else {}
        except Exception:
            parsed = {"error": str(err)}
        return False, int(err.code), parsed
    except URLError as err:
        return False, 0, {"error": f"url_error: {err.reason}"}
    except Exception as err:
        return False, 0, {"error": str(err)}


def append_integration_record(
    kind: str,
    payload: dict[str, Any],
    source: str,
    transport: dict[str, Any],
) -> dict[str, Any]:
    record = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "source": source,
        "created_at": utc_now(),
        "status": "queued",
        "attempts": 0,
        "payload": payload,
        "transport": transport,
    }
    db = SessionLocal()
    try:
        state = _lock_integration_state(db)
        queue = _safe_json_list(state.queue_json)
        queue.append(record)
        if len(queue) > 3000:
            queue = queue[-3000:]
        state.queue_json = json.dumps(queue, ensure_ascii=False)
        state.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as err:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"integration_queue_write_error: {err}")
    finally:
        db.close()
    log_integration_audit("queue.append", "ok", record_id=record["id"], note=kind, payload={"source": source})
    return record


def _dispatch_record(record: dict[str, Any]) -> tuple[bool, str]:
    transport = record.get("transport", {}) if isinstance(record.get("transport"), dict) else {}
    mode = str(transport.get("mode", "target_webhook")).strip()
    payload = record.get("payload", {}) if isinstance(record.get("payload"), dict) else {}
    if mode == "target_webhook":
        if not INTEGRATION_TARGET_WEBHOOK_URL:
            return False, "target_webhook_not_configured"
        ok, status, body = _http_post_json(
            INTEGRATION_TARGET_WEBHOOK_URL,
            {
                "app": "tz_generator_backend",
                "event": record.get("kind", "integration.event"),
                "at": utc_now(),
                "payload": payload,
            },
            timeout=INTEGRATION_TARGET_TIMEOUT,
        )
        return ok, f"http={status};{json.dumps(body, ensure_ascii=False)[:200]}"
    if mode == "endpoint":
        url = str(transport.get("url", "")).strip()
        if not url:
            return False, "endpoint_url_missing"
        token = str(transport.get("token", "")).strip()
        headers = transport.get("headers", {})
        if not isinstance(headers, dict):
            headers = {}
        ok, status, body = _http_post_json(url, payload, token=token, extra_headers=headers)
        return ok, f"http={status};{json.dumps(body, ensure_ascii=False)[:200]}"
    return False, f"unsupported_transport_mode:{mode}"


def flush_integration_queue(limit: int = 100) -> dict[str, Any]:
    db = SessionLocal()
    processed = 0
    success = 0
    failed = 0
    remained: list[dict[str, Any]] = []
    try:
        state = _lock_integration_state(db)
        queue = _safe_json_list(state.queue_json)
        history = _safe_json_list(state.history_json)
        for idx, item in enumerate(queue):
            if idx >= limit:
                remained.append(item)
                continue
            processed += 1
            item["attempts"] = int(item.get("attempts", 0)) + 1
            item["last_attempt_at"] = utc_now()
            ok, note = _dispatch_record(item)
            if ok:
                success += 1
                item["status"] = "sent"
                item["sent_at"] = utc_now()
                item["last_result"] = note
                history.append(item)
                log_integration_audit("queue.flush_item", "sent", record_id=item.get("id", ""), note=note)
            else:
                failed += 1
                item["status"] = "queued"
                item["last_result"] = note
                remained.append(item)
                log_integration_audit("queue.flush_item", "queued", record_id=item.get("id", ""), note=note)
        if len(remained) > 3000:
            remained = remained[-3000:]
        if len(history) > 10000:
            history = history[-10000:]
        state.queue_json = json.dumps(remained, ensure_ascii=False)
        state.history_json = json.dumps(history, ensure_ascii=False)
        state.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as err:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"integration_queue_flush_error: {err}")
    finally:
        db.close()
    return {
        "processed": processed,
        "success": success,
        "failed": failed,
        "queue_remaining": len(remained),
        "target_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
    }


def _cfg(settings: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for k in keys:
        if k in settings:
            return settings[k]
    return default


def run_enterprise_autopilot(
    payload: dict[str, Any],
    settings: dict[str, Any],
    procedure_id: str = "",
) -> dict[str, Any]:
    cfg = settings if isinstance(settings, dict) else {}
    simulation_mode = bool(_cfg(cfg, "simulationMode", "simulation_mode", default=ENTERPRISE_SIMULATION_MODE))
    stages: list[dict[str, Any]] = []
    queued_ids: list[str] = []

    def add_stage(name: str, ok: bool, detail: str, data: dict[str, Any] | None = None) -> None:
        stages.append({
            "name": name,
            "ok": ok,
            "detail": detail[:240],
            "data": data or {},
        })

    etp_enabled = bool(_cfg(cfg, "etpBidirectionalStatus", "etp_bidirectional_status", default=True))
    etp_endpoint = str(_cfg(cfg, "etpEndpoint", "etp_endpoint", default="")).strip()
    etp_token = str(_cfg(cfg, "etpToken", "etp_token", default="")).strip()
    if etp_enabled and etp_endpoint:
        status_url = etp_endpoint.rstrip("/") + "/status"
        if procedure_id:
            status_url += f"/{procedure_id}"
        ok, code, data = _http_get_json(status_url, token=etp_token)
        if ok:
            add_stage("etp.status.sync", True, f"http={code}", data)
        else:
            add_stage("etp.status.sync", False, f"http={code}", data)
            rec = append_integration_record(
                "enterprise.etp.status.sync",
                {"procedure_id": procedure_id, "payload": payload},
                "enterprise_autopilot",
                {
                    "mode": "endpoint",
                    "url": status_url,
                    "token": etp_token,
                    "headers": {"X-Integration-Profile": str(payload.get("profile", "eis"))},
                },
            )
            queued_ids.append(rec["id"])
    elif etp_enabled and simulation_mode:
        add_stage(
            "etp.status.sync",
            True,
            "simulated",
            {
                "procedure_id": procedure_id,
                "status": "draft",
                "source": "simulation_mode",
            },
        )
    else:
        add_stage("etp.status.sync", False, "skipped_not_configured")

    ecm_endpoint = str(_cfg(cfg, "ecmEndpoint", "ecm_endpoint", default="")).strip()
    ecm_token = str(_cfg(cfg, "ecmToken", "ecm_token", default="")).strip()
    ecm_route = str(_cfg(cfg, "ecmApprovalRoute", "ecm_approval_route", default="")).strip()
    if ecm_endpoint:
        url = ecm_endpoint.rstrip("/") + "/approvals"
        ok, code, data = _http_post_json(
            url,
            {"route": ecm_route, "payload": payload, "procedure_id": procedure_id},
            token=ecm_token,
        )
        if ok:
            add_stage("ecm.approval.submit", True, f"http={code}", data)
        else:
            add_stage("ecm.approval.submit", False, f"http={code}", data)
            rec = append_integration_record(
                "enterprise.ecm.approval.submit",
                {"route": ecm_route, "payload": payload, "procedure_id": procedure_id},
                "enterprise_autopilot",
                {"mode": "endpoint", "url": url, "token": ecm_token, "headers": {}},
            )
            queued_ids.append(rec["id"])
    elif simulation_mode:
        route_steps = [step.strip() for step in ecm_route.split("->") if step.strip()] or ["Юрист", "ИБ", "Финконтроль", "Руководитель"]
        add_stage(
            "ecm.approval.submit",
            True,
            "simulated",
            {
                "route": route_steps,
                "request_id": f"SIM-ECM-{uuid.uuid4().hex[:8].upper()}",
            },
        )
    else:
        add_stage("ecm.approval.submit", False, "skipped_not_configured")

    erp_endpoint = str(_cfg(cfg, "erpEndpoint", "erp_endpoint", default="")).strip()
    erp_token = str(_cfg(cfg, "erpToken", "erp_token", default="")).strip()
    if erp_endpoint:
        modules: list[str] = []
        if bool(_cfg(cfg, "erpSyncNsi", "erp_sync_nsi", default=True)):
            modules.append("nsi")
        if bool(_cfg(cfg, "erpSyncBudget", "erp_sync_budget", default=True)):
            modules.append("budget")
        if bool(_cfg(cfg, "erpSyncContracts", "erp_sync_contracts", default=True)):
            modules.append("contracts")
        if bool(_cfg(cfg, "erpSyncLimits", "erp_sync_limits", default=True)):
            modules.append("limits")
        url = erp_endpoint.rstrip("/") + "/sync"
        ok, code, data = _http_post_json(
            url,
            {"modules": modules, "payload": payload, "procedure_id": procedure_id},
            token=erp_token,
        )
        if ok:
            add_stage("erp.sync", True, f"http={code}", data)
        else:
            add_stage("erp.sync", False, f"http={code}", data)
            rec = append_integration_record(
                "enterprise.erp.sync",
                {"modules": modules, "payload": payload, "procedure_id": procedure_id},
                "enterprise_autopilot",
                {"mode": "endpoint", "url": url, "token": erp_token, "headers": {}},
            )
            queued_ids.append(rec["id"])
    elif simulation_mode:
        modules: list[str] = []
        if bool(_cfg(cfg, "erpSyncNsi", "erp_sync_nsi", default=True)):
            modules.append("nsi")
        if bool(_cfg(cfg, "erpSyncBudget", "erp_sync_budget", default=True)):
            modules.append("budget")
        if bool(_cfg(cfg, "erpSyncContracts", "erp_sync_contracts", default=True)):
            modules.append("contracts")
        if bool(_cfg(cfg, "erpSyncLimits", "erp_sync_limits", default=True)):
            modules.append("limits")
        add_stage(
            "erp.sync",
            True,
            "simulated",
            {
                "modules": modules,
                "synced_items": len(modules) * max(1, len(payload.get("items", [])) if isinstance(payload.get("items"), list) else 1),
            },
        )
    else:
        add_stage("erp.sync", False, "skipped_not_configured")

    crypto_endpoint = str(_cfg(cfg, "cryptoEndpoint", "crypto_endpoint", default="")).strip()
    crypto_token = str(_cfg(cfg, "cryptoToken", "crypto_token", default="")).strip()
    if crypto_endpoint:
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        url = crypto_endpoint.rstrip("/") + "/sign"
        ok, code, data = _http_post_json(
            url,
            {"digest_sha256": digest, "procedure_id": procedure_id},
            token=crypto_token,
        )
        if ok:
            add_stage("crypto.sign", True, f"http={code}", data)
        else:
            add_stage("crypto.sign", False, f"http={code}", data)
            rec = append_integration_record(
                "enterprise.crypto.sign",
                {"digest_sha256": digest, "procedure_id": procedure_id},
                "enterprise_autopilot",
                {"mode": "endpoint", "url": url, "token": crypto_token, "headers": {}},
            )
            queued_ids.append(rec["id"])
    elif simulation_mode:
        digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        add_stage(
            "crypto.sign",
            True,
            "simulated",
            {
                "digest_sha256": digest,
                "signature_id": f"SIM-SIGN-{uuid.uuid4().hex[:10].upper()}",
                "provider": str(_cfg(cfg, "cryptoProvider", "crypto_provider", default="cryptopro")),
            },
        )
    else:
        add_stage("crypto.sign", False, "skipped_not_configured")

    success = sum(1 for s in stages if s["ok"])
    failed = sum(1 for s in stages if not s["ok"] and not s["detail"].startswith("skipped_"))
    skipped = sum(1 for s in stages if s["detail"].startswith("skipped_"))
    result = {
        "ok": failed == 0,
        "stages_total": len(stages),
        "stages_success": success,
        "stages_failed": failed,
        "stages_skipped": skipped,
        "queued_retry_records": queued_ids,
        "stages": stages,
    }
    db = SessionLocal()
    try:
        state = _lock_integration_state(db)
        history = _safe_json_list(state.enterprise_status_json)
        history.append({
            "at": utc_now(),
            "procedure_id": procedure_id,
            "summary": {
                "success": success,
                "failed": failed,
                "skipped": skipped,
            },
            "stages": stages,
        })
        if len(history) > 2000:
            history = history[-2000:]
        state.enterprise_status_json = json.dumps(history, ensure_ascii=False)
        state.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
    return result


init_integration_db()

# ── AI proxy helpers ────────────────────────────────────────────
def _get_api_key(provider: str) -> str:
    p = provider.strip().lower()
    if p == "deepseek":
        return DEEPSEEK_API_KEY
    if p == "groq":
        return GROQ_API_KEY
    if p == "openrouter":
        return OPENROUTER_API_KEY
    raise HTTPException(status_code=400, detail=f"Неизвестный провайдер: {provider}")

def _get_ai_url(provider: str) -> str:
    p = provider.strip().lower()
    if p == "deepseek":
        return "https://api.deepseek.com/chat/completions"
    if p == "groq":
        return "https://api.groq.com/openai/v1/chat/completions"
    if p == "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions"
    raise HTTPException(status_code=400, detail=f"Неизвестный провайдер: {provider}")

def _call_ai(provider: str, model: str, messages: list, temperature: float = 0.3, max_tokens: int = 4096) -> dict:
    api_key = _get_api_key(provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"API ключ {provider} не настроен на сервере")
    url = _get_ai_url(provider)
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider.strip().lower() == "openrouter":
        headers["HTTP-Referer"] = "https://arharius.github.io/testzak/"
        headers["X-Title"] = "TZ Generator"

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = URLRequest(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=AI_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw)
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        raise HTTPException(status_code=502, detail=f"AI error {e.code}: {detail[:400]}")
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"AI connection error: {e.reason}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI error: {str(e)[:400]}")


def _call_ai_streaming(provider: str, model: str, messages: list, temperature: float = 0.3, max_tokens: int = 4096):
    """Stream AI response token by token. Yields SSE data lines."""
    api_key = _get_api_key(provider)
    if not api_key:
        raise HTTPException(status_code=400, detail=f"API ключ {provider} не настроен на сервере")
    url = _get_ai_url(provider)
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider.strip().lower() == "openrouter":
        headers["HTTP-Referer"] = "https://arharius.github.io/testzak/"
        headers["X-Title"] = "TZ Generator"

    body_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = URLRequest(url, data=body_bytes, headers=headers, method="POST")
    try:
        resp = urlopen(req, timeout=AI_TIMEOUT)
        for line in resp:
            decoded = line.decode("utf-8", errors="replace").strip()
            if decoded.startswith("data: "):
                chunk_str = decoded[6:]
                if chunk_str == "[DONE]":
                    break
                yield chunk_str
        resp.close()
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        yield json.dumps({"error": f"AI error {e.code}: {detail[:400]}"})
    except Exception as e:
        yield json.dumps({"error": f"AI error: {str(e)[:400]}"})

# ── ЮKassa helpers ──────────────────────────────────────────────
PLAN_PRICES = {
    "pro": {
        "amount": "29900.00",
        "currency": "RUB",
        "label": "Pro Business (1 месяц, за компанию)",
    },
    "annual": {
        "amount": "299000.00",
        "currency": "RUB",
        "label": "Pro Business (12 месяцев, за компанию)",
    },
}

def _yookassa_create_payment(amount: str, currency: str, description: str, return_url: str, metadata: dict, idempotency_key: str) -> dict:
    if not YOOKASSA_SHOP_ID or not YOOKASSA_SECRET_KEY:
        raise HTTPException(status_code=400, detail="ЮKassa не настроена на сервере")
    auth_b64 = base64.b64encode(f"{YOOKASSA_SHOP_ID}:{YOOKASSA_SECRET_KEY}".encode()).decode()
    payload = {
        "amount": {"value": amount, "currency": currency},
        "capture": True,
        "confirmation": {"type": "redirect", "return_url": return_url},
        "description": description,
        "metadata": metadata,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = URLRequest(
        "https://api.yookassa.ru/v3/payments",
        data=body,
        headers={
            "Authorization": f"Basic {auth_b64}",
            "Content-Type": "application/json",
            "Idempotence-Key": idempotency_key,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=25) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else str(e)
        raise HTTPException(status_code=502, detail=f"ЮKassa error {e.code}: {detail[:400]}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ЮKassa error: {str(e)[:400]}")

# ════════════════════════════════════════════════════════════════
# Endpoints
# ════════════════════════════════════════════════════════════════

@app.get("/")
def root():
    return {"message": "TZ Generator API", "version": app.version}

def _readiness_check(status: str, detail: str, critical: bool = False, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "status": status,
        "detail": detail,
        "critical": critical,
    }
    if extra:
        payload.update(extra)
    return payload


def _probe_database() -> dict[str, Any]:
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return _readiness_check("ok", "query_ok", critical=True)
    except Exception as err:
        return _readiness_check("error", f"{type(err).__name__}: {str(err)[:180]}", critical=True)
    finally:
        db.close()


def _probe_integration_store() -> tuple[dict[str, Any], dict[str, Any]]:
    db = SessionLocal()
    try:
        state = _ensure_integration_state(db)
        queue = _safe_json_list(state.queue_json)
        history = _safe_json_list(state.history_json)
        enterprise_status = _safe_json_list(state.enterprise_status_json)
        counts = {
            "queue_total": len(queue),
            "history_total": len(history),
            "enterprise_status_total": len(enterprise_status),
        }
        return _readiness_check(
            "ok",
            f"queue={counts['queue_total']}; history={counts['history_total']}; enterprise={counts['enterprise_status_total']}",
            critical=True,
            extra=counts,
        ), counts
    except Exception as err:
        return _readiness_check("error", f"{type(err).__name__}: {str(err)[:180]}", critical=True), {
            "queue_total": 0,
            "history_total": 0,
            "enterprise_status_total": 0,
        }
    finally:
        db.close()


def _build_readiness_payload() -> dict[str, Any]:
    ai_providers = {
        "deepseek": bool(DEEPSEEK_API_KEY),
        "groq": bool(GROQ_API_KEY),
        "openrouter": bool(OPENROUTER_API_KEY),
    }
    enabled_ai = [name for name, enabled in ai_providers.items() if enabled]
    db_check = _probe_database()
    integration_check, integration_counts = _probe_integration_store()
    email_ready = True
    email_detail = "smtp_configured" if SMTP_USER and SMTP_PASS else "direct_link_fallback"
    email_extra = {
        "smtp_configured": bool(SMTP_USER and SMTP_PASS),
        "delivery_mode": "smtp" if SMTP_USER and SMTP_PASS else "direct_link",
    }
    enterprise_ready = ENTERPRISE_SIMULATION_MODE or bool(INTEGRATION_TARGET_WEBHOOK_URL)
    if ENTERPRISE_SIMULATION_MODE:
        enterprise_detail = "simulation_mode_default"
    elif INTEGRATION_TARGET_WEBHOOK_URL:
        enterprise_detail = "live_target_configured"
    else:
        enterprise_detail = "live_target_missing"
    checks = {
        "database": db_check,
        "integration_store": integration_check,
        "security": _readiness_check(
            "ok" if JWT_SECRET != "dev-secret-change-in-prod" and not INTEGRATION_ALLOW_ANON else "degraded",
            "jwt_configured_and_anon_disabled"
            if JWT_SECRET != "dev-secret-change-in-prod" and not INTEGRATION_ALLOW_ANON
            else "default_jwt_secret_or_anonymous_integration_enabled",
        ),
        "email": _readiness_check(
            "ok" if email_ready else "degraded",
            email_detail,
            extra=email_extra,
        ),
        "ai": _readiness_check(
            "ok" if enabled_ai else "degraded",
            f"providers={','.join(enabled_ai)}" if enabled_ai else "no_server_side_ai_provider",
            extra={"providers": ai_providers},
        ),
        "search": _readiness_check(
            "ok" if _search_import_source != "stub" else "degraded",
            _search_import_source,
        ),
        "payments": _readiness_check(
            "ok" if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY else "degraded",
            "yookassa_configured" if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY else "yookassa_not_configured",
        ),
        "enterprise": _readiness_check(
            "ok" if enterprise_ready else "degraded",
            enterprise_detail,
            extra={
                "simulation_mode_default": ENTERPRISE_SIMULATION_MODE,
                "target_webhook_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
                "operating_mode": "simulation" if ENTERPRISE_SIMULATION_MODE else "live_target",
            },
        ),
    }
    critical_failures = [name for name, check in checks.items() if check.get("critical") and check["status"] == "error"]
    degraded_checks = [name for name, check in checks.items() if check["status"] != "ok"]
    status = "not_ready" if critical_failures else ("degraded" if degraded_checks else "ready")
    return {
        "ok": status != "not_ready",
        "ready": status == "ready",
        "status": status,
        "version": app.version,
        "checked_at": utc_now(),
        "summary": "all_systems_go"
        if status == "ready"
        else (
            f"critical_failures={','.join(critical_failures)}"
            if critical_failures
            else f"degraded={','.join(degraded_checks)}"
        ),
        "checks": checks,
        "free_tz_limit": FREE_TZ_LIMIT,
        "integration_auth_configured": bool(INTEGRATION_API_TOKEN),
        "integration_allow_anon": INTEGRATION_ALLOW_ANON,
        "integration_target_webhook_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
        "ai_providers": ai_providers,
        "search_module": _search_import_source,
        "yookassa": bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY),
        **integration_counts,
    }


@app.get("/health")
def health():
    readiness = _build_readiness_payload()
    return {
        "status": "ok",
        "version": app.version,
        "checked_at": readiness["checked_at"],
        "readiness": readiness["status"],
        "free_tz_limit": readiness["free_tz_limit"],
        "integration_queue": readiness["queue_total"],
        "integration_history": readiness["history_total"],
        "integration_enterprise_status": readiness["enterprise_status_total"],
        "integration_auth_configured": readiness["integration_auth_configured"],
        "integration_allow_anon": readiness["integration_allow_anon"],
        "integration_target_webhook_configured": readiness["integration_target_webhook_configured"],
        "ai_providers": readiness["ai_providers"],
        "search_module": readiness["search_module"],
        "yookassa": readiness["yookassa"],
    }


@app.get("/readiness")
@app.get("/api/v1/readiness")
def readiness():
    payload = _build_readiness_payload()
    status_code = 200 if payload["status"] in {"ready", "degraded"} else 503
    return JSONResponse(status_code=status_code, content=payload)


@app.get("/api/v1/ping")
def ping():
    return {"ok": True, "message": "pong"}


# ── Integration queue API ─────────────────────────────────────
@app.post("/api/v1/integration/event")
def integration_event(
    body: IntegrationEventIn,
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    access = require_integration_access(user, authorization, x_api_token)
    idem = (body.idempotency_key or "").strip()
    if idem:
        prev = _get_idempotency_response(idem)
        if prev:
            log_integration_audit("event.idempotency_hit", "ok", note=idem)
            return {**prev, "duplicate": True}
    record = append_integration_record(
        kind=body.kind,
        payload=body.payload,
        source=body.source,
        transport={"mode": "target_webhook"},
    )
    response = {"ok": True, "record_id": record["id"], "status": record["status"]}
    log_integration_audit("event.accepted", "ok", record_id=record["id"], note=f"access={access}")
    if idem:
        _store_idempotency_response(idem, response)
    return response


@app.post("/api/v1/integration/draft")
def integration_draft(
    payload: dict[str, Any],
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    access = require_integration_access(user, authorization, x_api_token)
    idem = str(payload.get("idempotency_key", "")).strip() if isinstance(payload, dict) else ""
    if idem:
        prev = _get_idempotency_response(idem)
        if prev:
            log_integration_audit("draft.idempotency_hit", "ok", note=idem)
            return {**prev, "duplicate": True}

    connector_endpoint = str(payload.get("connector_endpoint", "")).strip()
    connector_token = str(payload.get("connector_token", "")).strip()
    connector_headers = payload.get("connector_headers", {}) if isinstance(payload, dict) else {}
    transport: dict[str, Any]
    if connector_endpoint:
        transport = {
            "mode": "endpoint",
            "url": connector_endpoint,
            "token": connector_token,
            "headers": connector_headers if isinstance(connector_headers, dict) else {},
        }
    else:
        transport = {"mode": "target_webhook"}

    record = append_integration_record(
        kind="procurement.draft",
        payload=payload if isinstance(payload, dict) else {},
        source="platform_connector",
        transport=transport,
    )
    response = {"ok": True, "record_id": record["id"], "status": record["status"]}
    log_integration_audit("draft.accepted", "ok", record_id=record["id"], note=f"access={access}")
    if idem:
        _store_idempotency_response(idem, response)
    return response


@app.get("/api/v1/integration/queue")
def integration_queue(
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    access = require_integration_access(user, authorization, x_api_token)
    store = load_integration_store()
    queue = store.get("queue", [])
    history = store.get("history", [])
    enterprise_status = store.get("enterprise_status", [])
    return {
        "ok": True,
        "access": access,
        "queue_total": len(queue),
        "history_total": len(history),
        "enterprise_status_total": len(enterprise_status),
        "latest_queue": queue[-20:],
        "latest_history": history[-20:],
        "latest_enterprise_status": enterprise_status[-20:],
        "target_webhook_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
    }


@app.post("/api/v1/integration/audit")
def integration_audit(
    body: IntegrationAuditIn,
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    require_integration_access(user, authorization, x_api_token)
    db = SessionLocal()
    try:
        rows = (
            db.query(IntegrationAuditLog)
            .order_by(IntegrationAuditLog.id.desc())
            .limit(body.limit)
            .all()
        )
        return {
            "ok": True,
            "total": len(rows),
            "items": [
                {
                    "id": row.id,
                    "at": row.at,
                    "action": row.action,
                    "status": row.status,
                    "record_id": row.record_id,
                    "note": row.note,
                }
                for row in rows
            ],
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"integration_audit_read_error: {err}")
    finally:
        db.close()


@app.post("/api/v1/integration/flush")
def integration_flush(
    body: IntegrationFlushIn,
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    require_integration_access(user, authorization, x_api_token)
    result = flush_integration_queue(body.limit)
    log_integration_audit(
        "queue.flush",
        "ok",
        note=f"processed={result['processed']} success={result['success']} failed={result['failed']}",
    )
    return {"ok": True, **result}


# ── Enterprise automation API ─────────────────────────────────
@app.get("/api/v1/enterprise/health")
def enterprise_health(
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    access = require_enterprise_access(user, authorization, x_api_token)
    store = load_integration_store()
    return {
        "ok": True,
        "access": access,
        "queue_total": len(store.get("queue", [])),
        "history_total": len(store.get("history", [])),
        "enterprise_status_total": len(store.get("enterprise_status", [])),
        "integration_auth_configured": bool(INTEGRATION_API_TOKEN),
        "integration_allow_anon": INTEGRATION_ALLOW_ANON,
        "target_webhook_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
        "simulation_mode_default": ENTERPRISE_SIMULATION_MODE,
    }


@app.get("/api/v1/enterprise/status")
def enterprise_status(
    limit: int = Query(default=50, ge=1, le=500),
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    require_enterprise_access(user, authorization, x_api_token)
    store = load_integration_store()
    data = store.get("enterprise_status", [])
    return {"ok": True, "total": len(data), "items": data[-limit:]}


@app.post("/api/v1/enterprise/autopilot")
def enterprise_autopilot(
    body: EnterpriseAutopilotIn,
    user: Optional[User] = Depends(get_optional_user),
    authorization: Optional[str] = Header(default=None),
    x_api_token: Optional[str] = Header(default=None),
):
    access = require_enterprise_access(user, authorization, x_api_token)
    idem = (body.idempotency_key or "").strip()
    if idem:
        prev = _get_idempotency_response(idem)
        if prev:
            log_integration_audit("enterprise.autopilot.idempotency_hit", "ok", note=idem)
            return {**prev, "duplicate": True}

    result = run_enterprise_autopilot(
        payload=body.payload,
        settings=body.settings,
        procedure_id=(body.procedure_id or "").strip(),
    )
    immutable_on = bool(_cfg(body.settings, "immutableAudit", "immutable_audit", default=True))
    immutable_record = None
    if immutable_on:
        immutable_record = _append_immutable_audit(
            "enterprise.autopilot",
            {
                "access": access,
                "procedure_id": body.procedure_id,
                "stages_success": result.get("stages_success", 0),
                "stages_failed": result.get("stages_failed", 0),
                "queued_retry_records": result.get("queued_retry_records", []),
            },
        )
    log_integration_audit(
        "enterprise.autopilot",
        "ok" if result.get("ok") else "partial",
        note=f"success={result.get('stages_success', 0)} failed={result.get('stages_failed', 0)}",
        payload={"procedure_id": body.procedure_id},
    )
    response = {
        "ok": True,
        "access": access,
        "result": result,
        "immutable_audit": immutable_record,
    }
    if idem:
        _store_idempotency_response(idem, response)
    return response

# ── Auth ──────────────────────────────────────────────────────
@app.post("/api/auth/send-link")
@limiter.limit("5/minute")
def send_link(request: Request, req: SendLinkRequest, db: Session = Depends(get_db)):
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Некорректный email")
    token = create_magic_token(email, db)
    ok, link = send_magic_link(email, token)
    if ok:
        logger.info(f"Magic link sent to {email}")
        return {"ok": True, "message": "Письмо со ссылкой для входа отправлено"}
    else:
        # SMTP not configured or failed — return the link directly for self-service
        logger.info(f"Magic link (no SMTP) for {email}: {link}")
        return {
            "ok": True,
            "message": "Ссылка для входа (SMTP не настроен — скопируйте и откройте вручную)",
            "magic_link": link,
            "smtp_configured": False,
        }

@app.post("/api/auth/login")
@limiter.limit("10/minute")
def login_with_password(request: Request, req: LoginRequest, db: Session = Depends(get_db)):
    if not req.username.strip() or not req.password.strip():
        raise HTTPException(status_code=400, detail="Введите логин и пароль")
    user = authenticate_superadmin(req.username.strip(), req.password.strip(), db)
    if not user:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    jwt_token = create_jwt(user.email, user.role)
    logger.info(f"Password login: {user.email} role={user.role}")
    return {
        "ok": True,
        "token": jwt_token,
        "user": _user_response(user),
    }

@app.get("/api/auth/verify")
def verify_token(token: str = Query(...), db: Session = Depends(get_db)):
    email = verify_magic_token(token, db)
    if not email:
        raise HTTPException(status_code=400, detail="Ссылка недействительна или истекла")
    user = get_or_create_user(email, db)
    jwt_token = create_jwt(email, user.role)
    logger.info(f"User logged in: {email} role={user.role}")
    return {
        "ok": True,
        "token": jwt_token,
        "user": _user_response(user),
    }

@app.post("/api/auth/verify")
def verify_token_post(req: VerifyTokenRequest, db: Session = Depends(get_db)):
    email = verify_magic_token(req.token, db)
    if not email:
        raise HTTPException(status_code=400, detail="Ссылка недействительна или истекла")
    user = get_or_create_user(email, db)
    jwt_token = create_jwt(email, user.role)
    return {
        "ok": True,
        "token": jwt_token,
        "user": _user_response(user),
    }

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    resp = _user_response(user)
    resp["subscription_until"] = user.subscription_until.isoformat() if user.subscription_until else None
    return resp

# ── AI Proxy ──────────────────────────────────────────────────
@app.post("/api/ai/generate")
@limiter.limit("20/minute")
def ai_generate(request: Request, req: AIGenerateRequest, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    # Allow anonymous AI access when INTEGRATION_ALLOW_ANON is enabled
    if user is None:
        if not INTEGRATION_ALLOW_ANON:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
    else:
        require_active(user, db)
    result = _call_ai(req.provider, req.model, req.messages, req.temperature or 0.3, req.max_tokens or 4096)
    # Count usage (only for non-admin free users with limits)
    if user and user.role != "admin" and user.tz_limit != -1:
        user.tz_count = (user.tz_count or 0) + 1
        if not user.tz_month_start:
            user.tz_month_start = datetime(datetime.now(timezone.utc).year, datetime.now(timezone.utc).month, 1, tzinfo=timezone.utc)
        db.commit()
    return {"ok": True, "data": result}


@app.post("/api/ai/generate-stream")
@limiter.limit("20/minute")
def ai_generate_stream(request: Request, req: AIGenerateRequest, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Streaming AI generation — keeps connection alive, avoids Railway 60s timeout."""
    if user is None:
        if not INTEGRATION_ALLOW_ANON:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
    else:
        require_active(user, db)

    def event_stream():
        full_content = ""
        try:
            for chunk_str in _call_ai_streaming(req.provider, req.model, req.messages, req.temperature or 0.3, req.max_tokens or 4096):
                try:
                    chunk = json.loads(chunk_str)
                except json.JSONDecodeError:
                    continue
                if "error" in chunk:
                    yield f"data: {json.dumps({'error': chunk['error']})}\n\n"
                    return
                choices = chunk.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        full_content += content
                        yield f"data: {json.dumps({'token': content})}\n\n"
            # Final message with full content
            yield f"data: {json.dumps({'done': True, 'content': full_content})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)[:400]})}\n\n"

    # Count usage
    if user and user.role != "admin" and user.tz_limit != -1:
        user.tz_count = (user.tz_count or 0) + 1
        if not user.tz_month_start:
            user.tz_month_start = datetime(datetime.now(timezone.utc).year, datetime.now(timezone.utc).month, 1, tzinfo=timezone.utc)
        db.commit()

    from starlette.responses import StreamingResponse
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


class AIKeyRequest(BaseModel):
    provider: str

@app.post("/api/ai/key")
@limiter.limit("30/minute")
def ai_get_key(request: Request, req: AIKeyRequest, user: Optional[User] = Depends(get_optional_user), db: Session = Depends(get_db)):
    """Return server-side API key for authorized users to make direct streaming calls from browser.
    This avoids Railway's 60s HTTP timeout by letting the browser stream directly from AI provider."""
    if user is None:
        if not INTEGRATION_ALLOW_ANON:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
    else:
        require_active(user, db)
    api_key = _get_api_key(req.provider)
    url = _get_ai_url(req.provider)
    # Count usage
    if user and user.role != "admin" and user.tz_limit != -1:
        user.tz_count = (user.tz_count or 0) + 1
        if not user.tz_month_start:
            user.tz_month_start = datetime(datetime.now(timezone.utc).year, datetime.now(timezone.utc).month, 1, tzinfo=timezone.utc)
        db.commit()
    return {"ok": True, "key": api_key, "url": url}

# ── Search: internet specs ─────────────────────────────────────
@app.post("/api/search/specs")
@limiter.limit("15/minute")
async def search_specs(
    request: Request,
    req: SearchSpecsRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    if not req.product.strip():
        raise HTTPException(status_code=400, detail="Укажите модель товара")
    if user is not None:
        require_active(user, db)
    import time as _time
    t0 = _time.time()
    logger.info(f"Internet search: {req.product!r} type={req.goods_type!r}")
    exact_model = _looks_like_specific_model_query(req.product.strip())
    try:
        specs = await search_internet_specs(req.product.strip(), req.goods_type)
    except Exception as e:
        logger.error(f"Internet search EXCEPTION: {e}", exc_info=True)
        specs = []
    if exact_model and not _has_sufficient_exact_model_quality(specs):
        logger.warning(f"Internet search returned weak exact-model result for {req.product!r}, trying direct vendor resolver")
        try:
            direct_specs = _resolve_msi_exact_model_specs(req.product.strip(), req.goods_type)
        except Exception as e:
            logger.error(f"MSI exact-model resolver EXCEPTION: {e}", exc_info=True)
            direct_specs = []
        specs = direct_specs if _has_sufficient_exact_model_quality(direct_specs) else []
    elapsed = _time.time() - t0
    logger.info(f"Internet search done: {len(specs)} specs in {elapsed:.1f}s")
    return {"ok": True, "specs": specs, "source": "internet", "elapsed": round(elapsed, 1)}

# ── Search: EIS zakupki.gov.ru ─────────────────────────────────
@app.post("/api/search/eis")
@limiter.limit("15/minute")
async def search_eis(
    request: Request,
    req: SearchEisRequest,
    user: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Укажите запрос")
    if user is not None:
        require_active(user, db)
    import time as _time
    t0 = _time.time()
    logger.info(f"EIS search: {req.query!r} type={req.goods_type!r}")
    try:
        specs = await search_eis_specs(req.query.strip(), req.goods_type)
    except Exception as e:
        logger.error(f"EIS search EXCEPTION: {e}", exc_info=True)
        specs = []
    elapsed = _time.time() - t0
    logger.info(f"EIS search done: {len(specs)} specs in {elapsed:.1f}s")
    return {"ok": True, "specs": specs, "source": "eis", "elapsed": round(elapsed, 1)}

# ── Search: debug ──────────────────────────────────────────────
@app.get("/api/search/debug")
async def search_debug(q: str = "HP ProBook 450 G10"):
    """Debug endpoint to test search pipeline from Railway."""
    import asyncio
    try:
        from .search import _duckduckgo_search, _bing_search, _search_web, _fetch_url, _extract_text_from_html, _ai_extract_specs, _cache  # type: ignore
    except ImportError:
        from search import _duckduckgo_search, _bing_search, _search_web, _fetch_url, _extract_text_from_html, _ai_extract_specs, _cache

    loop = asyncio.get_event_loop()
    steps = {}

    # Step 1: DDG search
    try:
        q1 = f"{q} технические характеристики"
        r1 = await loop.run_in_executor(None, lambda: _duckduckgo_search(q1, num=3))
        steps["ddg"] = {"count": len(r1), "results": r1[:2]}
    except Exception as e:
        steps["ddg"] = {"error": str(e)}

    # Step 2: Bing search (always test even if DDG works)
    try:
        r2 = await loop.run_in_executor(None, lambda: _bing_search(q1, num=3))
        steps["bing"] = {"count": len(r2), "results": r2[:2]}
    except Exception as e:
        steps["bing"] = {"error": str(e)}

    # Step 3: Combined web search (DDG → Bing fallback)
    try:
        r3 = await loop.run_in_executor(None, lambda: _search_web(q1, num=3))
        steps["combined"] = {"count": len(r3), "source": "ddg" if steps.get("ddg", {}).get("count", 0) > 0 else "bing"}
    except Exception as e:
        steps["combined"] = {"error": str(e)}

    # Step 4: Try fetch first URL
    all_results = steps.get("ddg", {}).get("results", []) + steps.get("bing", {}).get("results", [])
    if all_results:
        url = all_results[0].get("link", "")
        if url:
            try:
                html = await loop.run_in_executor(None, lambda: _fetch_url(url, timeout=10))
                text = _extract_text_from_html(html, max_chars=1000) if html else ""
                steps["fetch_page"] = {"url": url, "html_len": len(html), "text_len": len(text), "text_preview": text[:300]}
            except Exception as e:
                steps["fetch_page"] = {"url": url, "error": str(e)}

    # Step 5: Test AI extraction with snippet context
    snippets = " ".join(r.get("snippet", "") for r in all_results[:3])
    if snippets:
        try:
            specs = await loop.run_in_executor(None, lambda: _ai_extract_specs(snippets, q, "laptop"))
            steps["ai_extract"] = {"specs_count": len(specs), "sample": specs[:3]}
        except Exception as e:
            steps["ai_extract"] = {"error": str(e)}
    else:
        steps["ai_extract"] = {"skipped": "no snippets"}

    return {"ok": True, "query": q, "steps": steps, "cache_size": len(_cache)}

# ── Payments ───────────────────────────────────────────────────
@app.post("/api/payment/create")
@limiter.limit("3/minute")
def payment_create(request: Request, req: PaymentCreateRequest, user: User = Depends(get_current_user)):
    plan = req.plan.strip().lower()
    if plan not in PLAN_PRICES:
        raise HTTPException(status_code=400, detail="Неверный план. Доступно: pro, annual")
    info = PLAN_PRICES[plan]
    return_url = req.return_url or YOOKASSA_RETURN_URL
    metadata = {"user_email": user.email, "plan": plan}
    payment = _yookassa_create_payment(
        amount=info["amount"],
        currency=info["currency"],
        description=f"TZ Generator — {info['label']}",
        return_url=return_url,
        metadata=metadata,
        idempotency_key=str(uuid.uuid4()),
    )
    confirmation_url = (payment.get("confirmation") or {}).get("confirmation_url", "")
    return {
        "ok": True,
        "payment_id": payment.get("id", ""),
        "confirmation_url": confirmation_url,
        "status": payment.get("status", ""),
    }

@app.post("/api/payment/webhook")
async def payment_webhook(request: Request, payload: dict, db: Session = Depends(get_db)):
    # Verify webhook: check notification secret header (YooKassa sends it as body field or header)
    if YOOKASSA_WEBHOOK_SECRET:
        secret_from_payload = str(payload.get("webhook_secret", "")).strip()
        if not hmac.compare_digest(secret_from_payload, YOOKASSA_WEBHOOK_SECRET):
            logger.warning("Webhook rejected: invalid secret")
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    event = str(payload.get("event", "")).lower()
    obj = payload.get("object", {}) if isinstance(payload.get("object"), dict) else {}
    payment_id = str(obj.get("id", "")).strip()
    status = str(obj.get("status", "")).lower()
    metadata = obj.get("metadata", {}) if isinstance(obj.get("metadata"), dict) else {}

    if event == "payment.succeeded" and status == "succeeded":
        # Double-check payment via YooKassa API to prevent forged webhooks
        if YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY and payment_id:
            try:
                auth_str = base64.b64encode(f"{YOOKASSA_SHOP_ID}:{YOOKASSA_SECRET_KEY}".encode()).decode()
                verify_req = URLRequest(
                    f"https://api.yookassa.ru/v3/payments/{payment_id}",
                    headers={"Authorization": f"Basic {auth_str}", "Content-Type": "application/json"},
                )
                with urlopen(verify_req, timeout=10) as resp:
                    real_payment = json.loads(resp.read().decode())
                if real_payment.get("status") != "succeeded":
                    logger.warning(f"Webhook payment {payment_id} not confirmed by API (status={real_payment.get('status')})")
                    return {"ok": True}  # Ignore — not actually paid
                # Use metadata from verified payment, not from webhook body
                metadata = real_payment.get("metadata", {}) if isinstance(real_payment.get("metadata"), dict) else metadata
            except Exception as exc:
                logger.warning(f"Payment verification failed for {payment_id}: {exc}")

        email = str(metadata.get("user_email", "")).lower().strip()
        plan = str(metadata.get("plan", "pro")).strip().lower()
        if email:
            user = db.query(User).filter_by(email=email).first()
            if user:
                from datetime import timedelta
                user.role = "pro"
                user.tz_limit = -1  # unlimited
                days = 365 if plan == "annual" else 31
                user.subscription_until = datetime.now(timezone.utc) + timedelta(days=days)
                db.commit()
                logger.info(f"User {email} upgraded to Pro (plan={plan}, payment={payment_id})")

    return {"ok": True}


# ╔══════════════════════════════════════════════════════════════════════╗
# ║                    TZ DOCUMENT HISTORY (CRUD)                       ║
# ╚══════════════════════════════════════════════════════════════════════╝

class TZDocumentSaveRequest(BaseModel):
    title: str = ""
    law_mode: str = "44"
    rows: list = Field(default_factory=list)  # [{type, model, qty, specs, meta}]
    compliance_score: Optional[int] = None
    readiness: Optional[dict[str, Any]] = None
    publication_dossier: Optional[dict[str, Any]] = None

class TZDocumentUpdateRequest(BaseModel):
    title: Optional[str] = None
    law_mode: Optional[str] = None
    rows: Optional[list] = None
    compliance_score: Optional[int] = None
    readiness: Optional[dict[str, Any]] = None
    publication_dossier: Optional[dict[str, Any]] = None


@app.post("/api/tz/save")
def save_tz_document(
    req: TZDocumentSaveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a new TZ document to history."""
    require_active(user, db)
    # Auto-generate title from first row if not provided
    title = req.title.strip()
    if not title and req.rows:
        first = req.rows[0] if isinstance(req.rows[0], dict) else {}
        goods_type = first.get("type", "")
        model_name = first.get("model", "")
        title = f"{goods_type} — {model_name}".strip(" — ") or "Без названия"

    # Extract primary goods_type and model from first row
    first_row = req.rows[0] if req.rows and isinstance(req.rows[0], dict) else {}
    goods_type = first_row.get("type", "")
    model_name = first_row.get("model", "")

    doc = TZDocument(
        id=str(uuid.uuid4()),
        user_email=user.email,
        title=title,
        goods_type=goods_type,
        model=model_name,
        specs_json=json.dumps(first_row.get("specs", []), ensure_ascii=False),
        law_mode=req.law_mode,
        rows_json=json.dumps(req.rows, ensure_ascii=False),
        compliance_score=req.compliance_score,
        readiness_json=json.dumps(req.readiness, ensure_ascii=False) if req.readiness is not None else None,
        publication_dossier_json=json.dumps(req.publication_dossier, ensure_ascii=False) if req.publication_dossier is not None else None,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    logger.info(f"TZ saved: {doc.id} by {user.email} ({len(req.rows)} rows)")
    return {
        "ok": True,
        "id": doc.id,
        "title": doc.title,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


@app.put("/api/tz/{doc_id}")
def update_tz_document(
    doc_id: str,
    req: TZDocumentUpdateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing TZ document."""
    require_active(user, db)
    doc = db.query(TZDocument).filter_by(id=doc_id, user_email=user.email).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    if req.title is not None:
        doc.title = req.title
    if req.law_mode is not None:
        doc.law_mode = req.law_mode
    if req.rows is not None:
        doc.rows_json = json.dumps(req.rows, ensure_ascii=False)
        # Update primary goods_type and model from first row
        if req.rows:
            first = req.rows[0] if isinstance(req.rows[0], dict) else {}
            doc.goods_type = first.get("type", doc.goods_type)
            doc.model = first.get("model", doc.model)
            doc.specs_json = json.dumps(first.get("specs", []), ensure_ascii=False)
    if req.compliance_score is not None:
        doc.compliance_score = req.compliance_score
    if req.readiness is not None:
        doc.readiness_json = json.dumps(req.readiness, ensure_ascii=False)
    if req.publication_dossier is not None:
        doc.publication_dossier_json = json.dumps(req.publication_dossier, ensure_ascii=False)

    db.commit()
    return {"ok": True, "id": doc.id, "updated_at": doc.updated_at.isoformat() if doc.updated_at else None}


@app.get("/api/tz/list")
def list_tz_documents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List user's TZ documents (newest first)."""
    total = db.query(TZDocument).filter_by(user_email=user.email).count()
    docs = (
        db.query(TZDocument)
        .filter_by(user_email=user.email)
        .order_by(TZDocument.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    items = []
    for d in docs:
        rows_count = 0
        readiness = None
        try:
            parsed = json.loads(d.rows_json or "[]")
            rows_count = len(parsed)
        except Exception:
            pass
        try:
            readiness = json.loads(getattr(d, "readiness_json", None) or "null")
        except Exception:
            readiness = None
        items.append({
            "id": d.id,
            "title": d.title,
            "goods_type": d.goods_type,
            "model": d.model,
            "law_mode": getattr(d, "law_mode", "44") or "44",
            "compliance_score": getattr(d, "compliance_score", None),
            "readiness_status": readiness.get("status") if isinstance(readiness, dict) else None,
            "readiness_blockers": len(readiness.get("blockers", [])) if isinstance(readiness, dict) and isinstance(readiness.get("blockers"), list) else 0,
            "rows_count": rows_count,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": getattr(d, "updated_at", None),
        })
    return {"ok": True, "total": total, "items": items}


@app.get("/api/tz/{doc_id}")
def get_tz_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a single TZ document with full data."""
    doc = db.query(TZDocument).filter_by(id=doc_id, user_email=user.email).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    rows = []
    readiness = None
    publication_dossier = None
    try:
        rows = json.loads(doc.rows_json or "[]")
    except Exception:
        pass
    try:
        readiness = json.loads(getattr(doc, "readiness_json", None) or "null")
    except Exception:
        readiness = None
    try:
        publication_dossier = json.loads(getattr(doc, "publication_dossier_json", None) or "null")
    except Exception:
        publication_dossier = None

    return {
        "ok": True,
        "doc": {
            "id": doc.id,
            "title": doc.title,
            "goods_type": doc.goods_type,
            "model": doc.model,
            "law_mode": getattr(doc, "law_mode", "44") or "44",
            "compliance_score": getattr(doc, "compliance_score", None),
            "readiness": readiness,
            "publication_dossier": publication_dossier,
            "rows": rows,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "updated_at": getattr(doc, "updated_at", None),
        },
    }


@app.delete("/api/tz/{doc_id}")
def delete_tz_document(
    doc_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a TZ document."""
    doc = db.query(TZDocument).filter_by(id=doc_id, user_email=user.email).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    db.delete(doc)
    db.commit()
    return {"ok": True, "deleted": doc_id}
