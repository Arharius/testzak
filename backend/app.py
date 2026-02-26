import json
import hmac
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi import Request as FastAPIRequest
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


STORE_FILE = Path(os.getenv("INTEGRATION_STORE_FILE", "/tmp/tz_integration_store.json"))
AUDIT_DB_FILE = Path(os.getenv("INTEGRATION_AUDIT_DB", "/tmp/tz_integration_audit.db"))
TARGET_WEBHOOK_URL = os.getenv("INTEGRATION_TARGET_WEBHOOK_URL", "").strip()
TARGET_WEBHOOK_TIMEOUT = float(os.getenv("INTEGRATION_TARGET_TIMEOUT", "12"))
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
OPENROUTER_REFERER = os.getenv("OPENROUTER_REFERER", "").strip()
OPENROUTER_TITLE = os.getenv("OPENROUTER_TITLE", "TZ Generator").strip()


def parse_cors_origins(raw: str) -> list[str]:
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


CORS_ALLOW_ORIGINS = parse_cors_origins(os.getenv("CORS_ALLOW_ORIGINS", ""))


def _default_store() -> dict[str, Any]:
    return {"queue": [], "history": []}


def load_store() -> dict[str, Any]:
    if not STORE_FILE.exists():
        return _default_store()
    try:
        raw = json.loads(STORE_FILE.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return _default_store()
        raw.setdefault("queue", [])
        raw.setdefault("history", [])
        return raw
    except Exception:
        return _default_store()


def save_store(data: dict[str, Any]) -> None:
    STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STORE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def init_audit_db() -> None:
    AUDIT_DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(AUDIT_DB_FILE) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
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
            CREATE TABLE IF NOT EXISTS idempotency_keys (
              idem_key TEXT PRIMARY KEY,
              created_at TEXT NOT NULL,
              response_json TEXT NOT NULL
            )
            """
        )
        conn.commit()


def log_audit(action: str, status: str, record_id: str = "", note: str = "", payload: dict[str, Any] | None = None) -> None:
    try:
        with sqlite3.connect(AUDIT_DB_FILE) as conn:
            conn.execute(
                "INSERT INTO audit_log (at, action, status, record_id, note, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
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
        # аудит не должен ронять сервис
        pass


def get_idempotency_response(idem_key: str) -> dict[str, Any] | None:
    try:
        with sqlite3.connect(AUDIT_DB_FILE) as conn:
            row = conn.execute(
                "SELECT response_json FROM idempotency_keys WHERE idem_key = ?",
                (idem_key,),
            ).fetchone()
            if not row:
                return None
            return json.loads(row[0])
    except Exception:
        return None


def store_idempotency_response(idem_key: str, response: dict[str, Any]) -> None:
    try:
        with sqlite3.connect(AUDIT_DB_FILE) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO idempotency_keys (idem_key, created_at, response_json) VALUES (?, ?, ?)",
                (idem_key, utc_now(), json.dumps(response, ensure_ascii=False)),
            )
            conn.commit()
    except Exception:
        pass


def append_record(kind: str, payload: dict[str, Any], source: str) -> dict[str, Any]:
    store = load_store()
    record = {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "source": source,
        "created_at": utc_now(),
        "status": "queued",
        "attempts": 0,
        "payload": payload,
    }
    store["queue"].append(record)
    if len(store["queue"]) > 2000:
        store["queue"] = store["queue"][-2000:]
    save_store(store)
    log_audit("queue.append", "ok", record_id=record["id"], note=kind, payload={"source": source})
    return record


def push_to_target(event: dict[str, Any]) -> tuple[bool, str]:
    if not TARGET_WEBHOOK_URL:
        return False, "target webhook is not configured"
    try:
        body = json.dumps(event, ensure_ascii=False).encode("utf-8")
        req = Request(
            TARGET_WEBHOOK_URL,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=TARGET_WEBHOOK_TIMEOUT) as response:
            code = getattr(response, "status", 200)
            if 200 <= code < 300:
                return True, f"http {code}"
            return False, f"http {code}"
    except HTTPError as err:
        return False, f"http {err.code}"
    except URLError as err:
        return False, f"url_error: {err.reason}"
    except Exception as err:
        return False, f"error: {err}"


def _extract_request_token(request: FastAPIRequest) -> str:
    auth = str(request.headers.get("authorization", "")).strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return str(request.headers.get("x-api-token", "")).strip()


def require_api_token(request: FastAPIRequest, expected_token: str, scope: str) -> None:
    if not expected_token:
        return
    got = _extract_request_token(request)
    if got and hmac.compare_digest(got, expected_token):
        return
    raise HTTPException(
        status_code=401,
        detail=f"{scope}_auth_required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _ai_provider_config(provider: str) -> tuple[str, str]:
    p = provider.strip().lower()
    if p == "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions", AI_PROXY_OPENROUTER_API_KEY
    if p == "groq":
        return "https://api.groq.com/openai/v1/chat/completions", AI_PROXY_GROQ_API_KEY
    if p == "deepseek":
        # DeepSeek OpenAI-compatible API path.
        return "https://api.deepseek.com/chat/completions", AI_PROXY_DEEPSEEK_API_KEY
    raise HTTPException(status_code=400, detail=f"unsupported_provider: {provider}")


def proxy_ai_chat_completion(
    provider: str,
    payload: dict[str, Any],
    body_api_key: str = "",
    timeout_sec: float | None = None,
) -> dict[str, Any]:
    url, env_api_key = _ai_provider_config(provider)
    api_key = (body_api_key or "").strip() or env_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail=f"{provider}_api_key_not_configured")

    timeout = float(timeout_sec or AI_PROXY_TIMEOUT)
    timeout = max(1.0, min(timeout, 120.0))
    raw_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if provider.strip().lower() == "openrouter":
        if OPENROUTER_REFERER:
            headers["HTTP-Referer"] = OPENROUTER_REFERER
        if OPENROUTER_TITLE:
            headers["X-Title"] = OPENROUTER_TITLE

    req = Request(url, data=raw_body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as response:
            code = int(getattr(response, "status", 200))
            text = response.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(text) if text else {}
            except json.JSONDecodeError:
                data = {"raw_text": text[:4000]}
            return {"ok": 200 <= code < 300, "status_code": code, "data": data}
    except HTTPError as err:
        try:
            text = err.read().decode("utf-8", errors="replace")
        except Exception:
            text = str(err)
        try:
            parsed = json.loads(text) if text else {}
        except json.JSONDecodeError:
            parsed = {"raw_text": text[:4000]}
        raise HTTPException(
            status_code=502,
            detail={
                "error": "upstream_http_error",
                "provider": provider,
                "upstream_status": err.code,
                "upstream_body": parsed,
            },
        )
    except URLError as err:
        raise HTTPException(status_code=502, detail=f"upstream_url_error: {err.reason}")
    except HTTPException:
        raise
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"ai_proxy_error: {err}")


def flush_queue(limit: int = 100) -> dict[str, Any]:
    store = load_store()
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
        ok, note = push_to_target(
            {
                "app": "tz_generator_backend",
                "event": item.get("kind", "integration.event"),
                "at": utc_now(),
                "payload": item.get("payload", {}),
            }
        )
        if ok:
            success += 1
            item["status"] = "sent"
            item["sent_at"] = utc_now()
            item["last_result"] = note
            store["history"].append(item)
            log_audit("queue.flush_item", "sent", record_id=item.get("id", ""), note=note)
        else:
            failed += 1
            item["status"] = "queued"
            item["last_result"] = note
            remained.append(item)
            log_audit("queue.flush_item", "queued", record_id=item.get("id", ""), note=note)

    if len(remained) > 2000:
        remained = remained[-2000:]
    store["queue"] = remained
    if len(store["history"]) > 5000:
        store["history"] = store["history"][-5000:]
    save_store(store)
    return {
        "processed": processed,
        "success": success,
        "failed": failed,
        "queue_remaining": len(remained),
        "target_configured": bool(TARGET_WEBHOOK_URL),
    }


class IntegrationEventIn(BaseModel):
    kind: str = Field(default="integration.event", min_length=3, max_length=120)
    source: str = Field(default="ui", min_length=1, max_length=120)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(default="", max_length=180)


class FlushIn(BaseModel):
    limit: int = Field(default=100, ge=1, le=500)


class AuditQueryIn(BaseModel):
    limit: int = Field(default=100, ge=1, le=1000)


class AIMessageIn(BaseModel):
    role: str = Field(min_length=1, max_length=40)
    content: Any
    name: str | None = Field(default=None, max_length=120)


class AIChatIn(BaseModel):
    provider: str = Field(min_length=3, max_length=40)
    model: str = Field(min_length=1, max_length=160)
    messages: list[AIMessageIn] = Field(min_length=1, max_length=100)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=65536)
    timeout_sec: float | None = Field(default=None, ge=1, le=120)
    api_key: str = Field(default="", max_length=500)
    extra: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(title="TZ Generator Backend", version="1.2.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS if CORS_ALLOW_ORIGINS else ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
init_audit_db()


@app.get("/health")
def health() -> dict[str, Any]:
    store = load_store()
    return {
        "status": "ok",
        "queue": len(store.get("queue", [])),
        "history": len(store.get("history", [])),
        "target_configured": bool(TARGET_WEBHOOK_URL),
        "integration_auth_configured": bool(INTEGRATION_API_TOKEN),
        "ai_proxy_auth_configured": bool(AI_PROXY_API_TOKEN),
        "ai_proxy_configured_providers": [
            name
            for name, is_ready in (
                ("openrouter", bool(AI_PROXY_OPENROUTER_API_KEY)),
                ("groq", bool(AI_PROXY_GROQ_API_KEY)),
                ("deepseek", bool(AI_PROXY_DEEPSEEK_API_KEY)),
            )
            if is_ready
        ],
        "cors_allow_origins": CORS_ALLOW_ORIGINS,
    }


@app.get("/api/v1/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}


@app.post("/api/v1/integration/event")
def integration_event(body: IntegrationEventIn, request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, INTEGRATION_API_TOKEN, "integration")
    idem = (body.idempotency_key or "").strip()
    if idem:
        prev = get_idempotency_response(idem)
        if prev:
            log_audit("event.idempotency_hit", "ok", note=idem)
            return {**prev, "duplicate": True}
    record = append_record(body.kind, body.payload, body.source)
    response = {"ok": True, "record_id": record["id"], "status": record["status"]}
    if idem:
        store_idempotency_response(idem, response)
    return response


@app.post("/api/v1/integration/draft")
def integration_draft(payload: dict[str, Any], request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, INTEGRATION_API_TOKEN, "integration")
    idem = str(payload.get("idempotency_key", "")).strip() if isinstance(payload, dict) else ""
    if idem:
        prev = get_idempotency_response(idem)
        if prev:
            log_audit("draft.idempotency_hit", "ok", note=idem)
            return {**prev, "duplicate": True}
    record = append_record("procurement.draft", payload, "platform_connector")
    response = {"ok": True, "record_id": record["id"], "status": record["status"]}
    if idem:
        store_idempotency_response(idem, response)
    return response


@app.get("/api/v1/integration/queue")
def integration_queue(request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, INTEGRATION_API_TOKEN, "integration")
    store = load_store()
    queue = store.get("queue", [])
    history = store.get("history", [])
    return {
        "ok": True,
        "queue_total": len(queue),
        "history_total": len(history),
        "latest_queue": queue[-20:],
        "latest_history": history[-20:],
        "target_webhook_configured": bool(TARGET_WEBHOOK_URL),
    }


@app.post("/api/v1/integration/audit")
def integration_audit(body: AuditQueryIn, request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, INTEGRATION_API_TOKEN, "integration")
    limit = body.limit
    try:
        with sqlite3.connect(AUDIT_DB_FILE) as conn:
            rows = conn.execute(
                "SELECT id, at, action, status, record_id, note FROM audit_log ORDER BY id DESC LIMIT ?",
                (limit,),
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
        raise HTTPException(status_code=500, detail=f"audit_read_error: {err}")


@app.post("/api/v1/integration/flush")
def integration_flush(body: FlushIn, request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, INTEGRATION_API_TOKEN, "integration")
    result = flush_queue(body.limit)
    if not result["target_configured"]:
        raise HTTPException(status_code=400, detail="INTEGRATION_TARGET_WEBHOOK_URL is not configured")
    log_audit("queue.flush", "ok", note=f"processed={result['processed']} success={result['success']} failed={result['failed']}")
    return {"ok": True, **result}


@app.get("/api/v1/ai/providers")
def ai_providers(request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, AI_PROXY_API_TOKEN, "ai_proxy")
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
def ai_chat(body: AIChatIn, request: FastAPIRequest) -> dict[str, Any]:
    require_api_token(request, AI_PROXY_API_TOKEN, "ai_proxy")
    provider = body.provider.strip().lower()
    payload: dict[str, Any] = {
        "model": body.model.strip(),
        "messages": [
            {
                key: value
                for key, value in {
                    "role": msg.role.strip(),
                    "content": msg.content,
                    "name": (msg.name or "").strip() or None,
                }.items()
                if value is not None
            }
            for msg in body.messages
        ],
        # Streaming is intentionally disabled for the first stable proxy version.
        "stream": False,
    }
    if body.temperature is not None:
        payload["temperature"] = body.temperature
    if body.max_tokens is not None:
        payload["max_tokens"] = body.max_tokens

    blocked_extra = {"model", "messages", "stream", "api_key", "provider"}
    for key, value in (body.extra or {}).items():
        if not isinstance(key, str):
            continue
        k = key.strip()
        if not k or k in blocked_extra:
            continue
        payload[k] = value

    upstream = proxy_ai_chat_completion(
        provider=provider,
        payload=payload,
        body_api_key=body.api_key,
        timeout_sec=body.timeout_sec,
    )
    usage = {}
    if isinstance(upstream.get("data"), dict):
        usage = upstream["data"].get("usage", {}) or {}
    log_audit(
        "ai.chat",
        "ok" if upstream.get("ok") else "upstream_error",
        note=f"{provider}:{body.model[:80]}",
        payload={
            "provider": provider,
            "model": body.model[:120],
            "messages_count": len(body.messages),
            "usage": usage if isinstance(usage, dict) else {},
        },
    )
    return {"ok": True, "provider": provider, **upstream}
