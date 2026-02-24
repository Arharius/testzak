import json
import os
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
        else:
            failed += 1
            item["status"] = "queued"
            item["last_result"] = note
            remained.append(item)

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


class FlushIn(BaseModel):
    limit: int = Field(default=100, ge=1, le=500)


app = FastAPI(title="TZ Generator Backend", version="1.1.0", docs_url="/docs")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    record = append_record(body.kind, body.payload, body.source)
    return {"ok": True, "record_id": record["id"], "status": record["status"]}


@app.post("/api/v1/integration/draft")
def integration_draft(payload: dict[str, Any]) -> dict[str, Any]:
    record = append_record("procurement.draft", payload, "platform_connector")
    return {"ok": True, "record_id": record["id"], "status": record["status"]}


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


@app.post("/api/v1/integration/flush")
def integration_flush(body: FlushIn) -> dict[str, Any]:
    result = flush_queue(body.limit)
    if not result["target_configured"]:
        raise HTTPException(status_code=400, detail="INTEGRATION_TARGET_WEBHOOK_URL is not configured")
    return {"ok": True, **result}
