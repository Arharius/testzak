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
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from urllib.request import Request as URLRequest, urlopen
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, init_db, User, MagicToken
from auth import (
    send_magic_link,
    create_magic_token,
    verify_magic_token,
    get_or_create_user,
    create_jwt,
    decode_jwt,
)

# ── Search module ──────────────────────────────────────────────
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
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "arharius@yandex.ru").lower().strip()

DEEPSEEK_API_KEY    = os.getenv("DEEPSEEK_API_KEY", "").strip()
GROQ_API_KEY        = os.getenv("GROQ_API_KEY", "").strip()
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "").strip()

YOOKASSA_SHOP_ID       = os.getenv("YOOKASSA_SHOP_ID", "").strip()
YOOKASSA_SECRET_KEY    = os.getenv("YOOKASSA_SECRET_KEY", "").strip()
YOOKASSA_RETURN_URL    = os.getenv("YOOKASSA_RETURN_URL", "https://arharius.github.io/testzak/").strip()
YOOKASSA_WEBHOOK_SECRET = os.getenv("YOOKASSA_WEBHOOK_SECRET", "").strip()

AI_TIMEOUT = float(os.getenv("AI_TIMEOUT", "60"))

FREE_TZ_LIMIT = int(os.getenv("FREE_TZ_LIMIT", "5"))

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
    return {
        "status": "ok",
        "ai_providers": {
            "deepseek":   bool(DEEPSEEK_API_KEY),
            "groq":       bool(GROQ_API_KEY),
            "openrouter": bool(OPENROUTER_API_KEY),
        },
        "yookassa": bool(YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY),
    }

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
