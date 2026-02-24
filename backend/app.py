import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


STORE_FILE = Path(os.getenv("INTEGRATION_STORE_FILE", "/tmp/tz_integration_store.json"))
AUDIT_DB_FILE = Path(os.getenv("INTEGRATION_AUDIT_DB", "/tmp/tz_integration_audit.db"))
TARGET_WEBHOOK_URL = os.getenv("INTEGRATION_TARGET_WEBHOOK_URL", "").strip()
TARGET_WEBHOOK_TIMEOUT = float(os.getenv("INTEGRATION_TARGET_TIMEOUT", "12"))


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


app = FastAPI(title="TZ Generator Backend", version="1.1.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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
    }


@app.get("/api/v1/ping")
def ping() -> dict[str, str]:
    return {"message": "pong"}


@app.post("/api/v1/integration/event")
def integration_event(body: IntegrationEventIn) -> dict[str, Any]:
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
def integration_draft(payload: dict[str, Any]) -> dict[str, Any]:
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
def integration_queue() -> dict[str, Any]:
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
def integration_audit(body: AuditQueryIn) -> dict[str, Any]:
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
def integration_flush(body: FlushIn) -> dict[str, Any]:
    result = flush_queue(body.limit)
    if not result["target_configured"]:
        raise HTTPException(status_code=400, detail="INTEGRATION_TARGET_WEBHOOK_URL is not configured")
    log_audit("queue.flush", "ok", note=f"processed={result['processed']} success={result['success']} failed={result['failed']}")
    return {"ok": True, **result}
