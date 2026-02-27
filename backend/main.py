"""
TZ Generator — FastAPI backend
Endpoints:
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
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Any
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

# Package-safe imports (works for both `uvicorn backend.main:app` and `uvicorn main:app`)
try:
    from .database import get_db, init_db, User, MagicToken  # type: ignore
    from .auth import (  # type: ignore
        send_magic_link,
        create_magic_token,
        verify_magic_token,
        get_or_create_user,
        create_jwt,
        decode_jwt,
        sync_user_entitlements,
    )
except ImportError:
    from database import get_db, init_db, User, MagicToken
    from auth import (
        send_magic_link,
        create_magic_token,
        verify_magic_token,
        get_or_create_user,
        create_jwt,
        decode_jwt,
        sync_user_entitlements,
    )

# ── Search module ──────────────────────────────────────────────
try:
    from .search import search_internet_specs, search_eis_specs  # type: ignore
except ImportError:
    try:
        from search import search_internet_specs, search_eis_specs
    except ImportError:
        async def search_internet_specs(product: str, goods_type: str) -> list:  # type: ignore
            return []
        async def search_eis_specs(query: str, goods_type: str) -> list:  # type: ignore
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

AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "60"))

FREE_TZ_LIMIT = int(os.getenv("FREE_TZ_LIMIT", "3"))

# ── Integration / Enterprise automation env ───────────────────
INTEGRATION_STORE_FILE = Path(os.getenv("INTEGRATION_STORE_FILE", "/tmp/tz_integration_store_main.json"))
INTEGRATION_AUDIT_DB = Path(os.getenv("INTEGRATION_AUDIT_DB", "/tmp/tz_integration_audit_main.db"))
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
    "https://arharius.github.io",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]

# ── FastAPI app ─────────────────────────────────────────────────
app = FastAPI(title="TZ Generator API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()

# ── Pydantic models ─────────────────────────────────────────────
class SendLinkRequest(BaseModel):
    email: str

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

def require_active(user: User) -> None:
    """Check that user can generate TZ (not over limit)."""
    if user.role == "admin":
        return  # unlimited
    if user.tz_limit == -1:
        return  # explicitly unlimited (pro)
    # Check monthly count
    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    if hasattr(user, "tz_month_start") and user.tz_month_start:
        ms = user.tz_month_start
        if hasattr(ms, "replace"):
            ms = ms.replace(tzinfo=timezone.utc)
        if ms < month_start:
            # New month — reset
            user.tz_count = 0
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


def load_integration_store() -> dict[str, Any]:
    if not INTEGRATION_STORE_FILE.exists():
        return _default_integration_store()
    try:
        raw = json.loads(INTEGRATION_STORE_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return _default_integration_store()
        raw.setdefault("queue", [])
        raw.setdefault("history", [])
        raw.setdefault("enterprise_status", [])
        return raw
    except Exception:
        return _default_integration_store()


def save_integration_store(data: dict[str, Any]) -> None:
    INTEGRATION_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    INTEGRATION_STORE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def init_integration_db() -> None:
    INTEGRATION_AUDIT_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS integration_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              action TEXT NOT NULL,
              status TEXT NOT NULL,
              record_id TEXT,
              note TEXT,
              payload_json TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS integration_idempotency_keys (
              idem_key TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              response_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS immutable_audit_chain (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              at TEXT NOT NULL,
              action TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              prev_hash TEXT NOT NULL,
              hash TEXT NOT NULL
            )
            """
        )
        conn.commit()


def log_integration_audit(
    action: str,
    status: str,
    record_id: str = "",
    note: str = "",
    payload: dict[str, Any] | None = None
) -> None:
    try:
        with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
            conn.execute(
                "INSERT INTO integration_audit_log (at, action, status, record_id, note, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    utc_now(),
                    action,
                    status,
                    record_id,
                    note[:400],
                    json.dumps(payload or {}, ensure_ascii=False),
                ),
            )
            conn.commit()
    except Exception:
        pass


def _get_idempotency_response(idem_key: str) -> dict[str, Any] | None:
    try:
        with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
            row = conn.execute(
                "SELECT response_json FROM integration_idempotency_keys WHERE idem_key = ?",
                (idem_key,),
            ).fetchone()
            if not row:
                return None
            return json.loads(row[0])
    except Exception:
        return None


def _store_idempotency_response(idem_key: str, response: dict[str, Any]) -> None:
    try:
        with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO integration_idempotency_keys (idem_key, created_at, response_json) VALUES (?, ?, ?)",
                (idem_key, utc_now(), json.dumps(response, ensure_ascii=False)),
            )
            conn.commit()
    except Exception:
        pass


def _append_immutable_audit(action: str, payload: dict[str, Any]) -> dict[str, Any]:
    at = utc_now()
    with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
        prev_row = conn.execute(
            "SELECT hash FROM immutable_audit_chain ORDER BY id DESC LIMIT 1"
        ).fetchone()
        prev_hash = str(prev_row[0]) if prev_row else "genesis"
        payload_json = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        base = f"{at}|{action}|{payload_json}|{prev_hash}"
        digest = hashlib.sha256(base.encode("utf-8")).hexdigest()
        conn.execute(
            "INSERT INTO immutable_audit_chain (at, action, payload_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?)",
            (at, action, payload_json, prev_hash, digest),
        )
        conn.commit()
        return {
            "at": at,
            "action": action,
            "prev_hash": prev_hash,
            "hash": digest,
        }


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
    store = load_integration_store()
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
    store["queue"].append(record)
    if len(store["queue"]) > 3000:
        store["queue"] = store["queue"][-3000:]
    save_integration_store(store)
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
    store = load_integration_store()
    queue = store.get("queue", [])
    processed = 0
    success = 0
    failed = 0
    remained: list[dict[str, Any]] = []
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
            store["history"].append(item)
            log_integration_audit("queue.flush_item", "sent", record_id=item.get("id", ""), note=note)
        else:
            failed += 1
            item["status"] = "queued"
            item["last_result"] = note
            remained.append(item)
            log_integration_audit("queue.flush_item", "queued", record_id=item.get("id", ""), note=note)
    if len(remained) > 3000:
        remained = remained[-3000:]
    store["queue"] = remained
    if len(store["history"]) > 10000:
        store["history"] = store["history"][-10000:]
    save_integration_store(store)
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
    store = load_integration_store()
    history = store.get("enterprise_status", [])
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
    store["enterprise_status"] = history
    save_integration_store(store)
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

# ── ЮKassa helpers ──────────────────────────────────────────────
PLAN_PRICES = {
    "pro":    {"amount": "1500.00", "currency": "RUB", "label": "Pro (1 месяц)"},
    "annual": {"amount": "12000.00", "currency": "RUB", "label": "Pro (12 месяцев)"},
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
    return {"message": "TZ Generator API", "version": "2.0"}

@app.get("/health")
def health():
    store = load_integration_store()
    return {
        "status": "ok",
        "free_tz_limit": FREE_TZ_LIMIT,
        "integration_queue": len(store.get("queue", [])),
        "integration_history": len(store.get("history", [])),
        "integration_auth_configured": bool(INTEGRATION_API_TOKEN),
        "integration_allow_anon": INTEGRATION_ALLOW_ANON,
        "integration_target_webhook_configured": bool(INTEGRATION_TARGET_WEBHOOK_URL),
        "ai_providers": {
            "deepseek":   bool(DEEPSEEK_API_KEY),
            "groq":       bool(GROQ_API_KEY),
            "openrouter": bool(OPENROUTER_API_KEY),
        },
        "yookassa": bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY),
    }


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
    try:
        with sqlite3.connect(INTEGRATION_AUDIT_DB) as conn:
            rows = conn.execute(
                "SELECT id, at, action, status, record_id, note FROM integration_audit_log ORDER BY id DESC LIMIT ?",
                (body.limit,),
            ).fetchall()
        return {
            "ok": True,
            "total": len(rows),
            "items": [
                {
                    "id": row[0],
                    "at": row[1],
                    "action": row[2],
                    "status": row[3],
                    "record_id": row[4],
                    "note": row[5],
                }
                for row in rows
            ],
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"integration_audit_read_error: {err}")


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
def send_link(req: SendLinkRequest, db: Session = Depends(get_db)):
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Некорректный email")
    token = create_magic_token(email, db)
    ok = send_magic_link(email, token)
    if not ok:
        raise HTTPException(status_code=500, detail="Не удалось отправить письмо. Проверьте настройки SMTP.")
    logger.info(f"Magic link sent to {email}")
    return {"ok": True, "message": "Письмо со ссылкой для входа отправлено"}

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
        "user": {
            "email": user.email,
            "role": user.role,
            "tz_count": user.tz_count,
            "tz_limit": user.tz_limit,
        },
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
        "user": {
            "email": user.email,
            "role": user.role,
            "tz_count": user.tz_count,
            "tz_limit": user.tz_limit,
        },
    }

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {
        "email": user.email,
        "role": user.role,
        "tz_count": user.tz_count,
        "tz_limit": user.tz_limit,
        "subscription_until": user.subscription_until.isoformat() if user.subscription_until else None,
    }

# ── AI Proxy ──────────────────────────────────────────────────
@app.post("/api/ai/generate")
def ai_generate(req: AIGenerateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_active(user)
    result = _call_ai(req.provider, req.model, req.messages, req.temperature or 0.3, req.max_tokens or 4096)
    # Count usage (only for non-admin free users)
    if user.role != "admin" and user.tz_limit != -1:
        user.tz_count = (user.tz_count or 0) + 1
        db.commit()
    return {"ok": True, "data": result}

# ── Search: internet specs ─────────────────────────────────────
@app.post("/api/search/specs")
async def search_specs(req: SearchSpecsRequest, user: User = Depends(get_current_user)):
    if not req.product.strip():
        raise HTTPException(status_code=400, detail="Укажите модель товара")
    logger.info(f"Internet search: {req.product!r}")
    specs = await search_internet_specs(req.product.strip(), req.goods_type)
    return {"ok": True, "specs": specs, "source": "internet"}

# ── Search: EIS zakupki.gov.ru ─────────────────────────────────
@app.post("/api/search/eis")
async def search_eis(req: SearchEisRequest, user: User = Depends(get_current_user)):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Укажите запрос")
    logger.info(f"EIS search: {req.query!r}")
    specs = await search_eis_specs(req.query.strip(), req.goods_type)
    return {"ok": True, "specs": specs, "source": "eis"}

# ── Payments ───────────────────────────────────────────────────
@app.post("/api/payment/create")
def payment_create(req: PaymentCreateRequest, user: User = Depends(get_current_user)):
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
async def payment_webhook(payload: dict, db: Session = Depends(get_db)):
    # Verify webhook secret if configured
    if YOOKASSA_WEBHOOK_SECRET:
        secret_from_payload = str(payload.get("webhook_secret", "")).strip()
        if not hmac.compare_digest(secret_from_payload, YOOKASSA_WEBHOOK_SECRET):
            raise HTTPException(status_code=401, detail="Invalid webhook secret")

    event = str(payload.get("event", "")).lower()
    obj = payload.get("object", {}) if isinstance(payload.get("object"), dict) else {}
    status = str(obj.get("status", "")).lower()
    metadata = obj.get("metadata", {}) if isinstance(obj.get("metadata"), dict) else {}

    if event == "payment.succeeded" and status == "succeeded":
        email = str(metadata.get("user_email", "")).lower().strip()
        plan = str(metadata.get("plan", "pro")).strip().lower()
        if email:
            user = db.query(User).filter_by(email=email).first()
            if user:
                user.role = "pro"
                user.tz_limit = -1  # unlimited
                if plan == "annual":
                    from datetime import timedelta
                    user.subscription_until = datetime.now(timezone.utc) + timedelta(days=365)
                else:
                    from datetime import timedelta
                    user.subscription_until = datetime.now(timezone.utc) + timedelta(days=31)
                db.commit()
                logger.info(f"User {email} upgraded to Pro (plan={plan})")

    return {"ok": True}
