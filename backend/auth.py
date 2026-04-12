import os, uuid, secrets, smtplib, hashlib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import jwt

try:
    from .database import User, MagicToken, get_db  # type: ignore
except ImportError:
    from database import User, MagicToken, get_db

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 30  # 30 days

if JWT_SECRET == "dev-secret-change-in-prod":
    import warnings
    warnings.warn(
        "⚠️  JWT_SECRET is default! Set JWT_SECRET env var in production. "
        "Current sessions are insecure.",
        stacklevel=2,
    )

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.yandex.ru")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_TIMEOUT = int(os.getenv("SMTP_TIMEOUT", "10"))
APP_URL = os.getenv("APP_URL", "https://tz-generator-frontend.onrender.com/react/")

def _safe_int(value: str, default: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default

FREE_TZ_LIMIT = max(0, _safe_int(os.getenv("FREE_TZ_LIMIT", "0"), 0))
TRIAL_DAYS = max(0, _safe_int(os.getenv("TRIAL_DAYS", "14"), 14))
POST_TRIAL_TZ_LIMIT = max(0, _safe_int(os.getenv("POST_TRIAL_TZ_LIMIT", str(FREE_TZ_LIMIT)), FREE_TZ_LIMIT))
# Count-based trial: new users get this many free ТЗ before payment required
TRIAL_TZ_COUNT = max(1, _safe_int(os.getenv("TRIAL_TZ_COUNT", "3"), 3))

PLAN_TZ_LIMITS: dict[str, int | None] = {
    "trial": TRIAL_TZ_COUNT,
    "start": 15,
    "base": 50,
    "team": None,
    "corp": None,
    "admin": None,
}

def _get_effective_plan(user: "User") -> str:
    """Derive the effective plan string from user fields."""
    stored = getattr(user, "plan", None)
    if stored and stored in PLAN_TZ_LIMITS:
        return stored
    if user.role == "admin":
        return "admin"
    if user.role == "free":
        return "trial"
    lim = getattr(user, "tz_limit", -1)
    if lim == 15:
        return "start"
    if lim == 50:
        return "base"
    if lim == -1:
        return "team"
    return "trial"


def check_access(user: "User", db=None) -> dict:
    """Full access check — returns {"allowed": bool, ...}.
    Call after require_active if you need structured error details."""
    now = datetime.now(timezone.utc)
    plan = _get_effective_plan(user)

    if plan == "admin":
        return {"allowed": True, "plan": plan, "remaining": None}

    if plan == "trial":
        trial_exp = None
        if user.trial_ends_at:
            trial_exp = user.trial_ends_at
            if getattr(trial_exp, "tzinfo", None) is None:
                trial_exp = trial_exp.replace(tzinfo=timezone.utc)
            if now > trial_exp:
                return {
                    "allowed": False,
                    "plan": plan,
                    "reason": "trial_expired",
                    "message": "Триальный период завершён (14 дней)",
                }
        tz_count = user.tz_count or 0
        if tz_count >= TRIAL_TZ_COUNT:
            return {
                "allowed": False,
                "plan": plan,
                "reason": "trial_limit",
                "message": f"Использовано {TRIAL_TZ_COUNT}/{TRIAL_TZ_COUNT} бесплатных ТЗ",
            }
        tz_left = TRIAL_TZ_COUNT - tz_count
        days_left = max(0, (trial_exp - now).days) if trial_exp else TRIAL_DAYS
        return {"allowed": True, "plan": plan, "remaining": {"tz_left": tz_left, "days_left": days_left}}

    sub_exp = user.subscription_until
    if not sub_exp:
        return {"allowed": False, "plan": plan, "reason": "subscription_expired", "message": "Подписка истекла"}
    if getattr(sub_exp, "tzinfo", None) is None:
        sub_exp = sub_exp.replace(tzinfo=timezone.utc)
    if now > sub_exp:
        return {"allowed": False, "plan": plan, "reason": "subscription_expired", "message": "Подписка истекла"}

    if plan in ("start", "base"):
        limit = PLAN_TZ_LIMITS[plan]
        month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        tz_ms = user.tz_month_start
        if tz_ms:
            if getattr(tz_ms, "tzinfo", None) is None:
                tz_ms = tz_ms.replace(tzinfo=timezone.utc)
            if tz_ms < month_start:
                user.tz_count = 0
                user.tz_month_start = month_start
                if db:
                    db.commit()
        else:
            user.tz_month_start = month_start
            if db:
                db.commit()
        if (user.tz_count or 0) >= limit:
            return {
                "allowed": False,
                "plan": plan,
                "reason": "monthly_limit",
                "message": f"Лимит {limit} ТЗ/мес исчерпан",
            }

    return {"allowed": True, "plan": plan, "remaining": None}

def _csv_emails(value: str) -> list[str]:
    return [s.strip().lower() for s in str(value or "").split(",") if s.strip()]

_legacy_admin = os.getenv("ADMIN_EMAIL", "Arharius@yandex.ru")
ADMIN_EMAILS = set(
    _csv_emails(_legacy_admin)
    + _csv_emails(os.getenv("ADMIN_EMAILS", ""))
    + _csv_emails(os.getenv("SUPERUSER_EMAILS", ""))
)

def is_admin_email(email: str) -> bool:
    return email.lower().strip() in ADMIN_EMAILS

def is_trial_active(user: User) -> bool:
    """Trial is active while free user has used fewer than TRIAL_TZ_COUNT ТЗ."""
    if user.role in {"admin", "pro"}:
        return False
    return (user.tz_count or 0) < TRIAL_TZ_COUNT


def trial_tz_left(user: User) -> int:
    """Return number of free ТЗ remaining in trial (0 if used up or paid)."""
    if user.role in {"admin", "pro"}:
        return 0
    return max(0, TRIAL_TZ_COUNT - (user.tz_count or 0))


def trial_days_left(user: User) -> int:
    """Legacy: kept for backward compat — returns trial_tz_left."""
    return trial_tz_left(user)


def is_payment_required(user: User) -> bool:
    """Return True when user must purchase Pro to continue working."""
    if user.role in {"admin", "pro"}:
        return False
    return not is_trial_active(user)


def payment_required_message(user: User) -> str:
    """Human-readable payment gate reason."""
    if user.role in {"admin", "pro"}:
        return ""
    return (
        f"Использовано все {TRIAL_TZ_COUNT} бесплатных ТЗ. "
        "Выберите тарифный план для продолжения работы."
    )


def sync_user_entitlements(user: User) -> bool:
    """Bring DB user role/limits in line with env-configured entitlements."""
    changed = False
    email = (user.email or "").lower().strip()

    # Promote configured superusers/admins automatically.
    if is_admin_email(email) and user.role != "admin":
        user.role = "admin"
        changed = True

    # Keep unlimited for admin/pro, standardize free trial limit for free users.
    if user.role in {"admin", "pro"}:
        if user.tz_limit != -1:
            user.tz_limit = -1
            changed = True
    else:
        # Free user — set limit to trial count (enforced via tz_count check)
        desired_limit = TRIAL_TZ_COUNT
        if user.tz_limit != desired_limit:
            user.tz_limit = desired_limit
            changed = True

    return changed

def send_magic_link(email: str, token: str):
    """Send magic link email via SMTP. Returns (sent_ok, magic_link)."""
    link = f"{APP_URL}?magic={token}"
    # If SMTP is not configured, skip sending — caller will return link directly
    if not SMTP_USER or not SMTP_PASS:
        print(f"SMTP not configured, magic link: {link}")
        return False, link
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Вход в Генератор ТЗ"
    msg["From"] = SMTP_USER
    msg["To"] = email
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#1F5C8B">Генератор ТЗ для госзакупок</h2>
      <p>Нажмите кнопку для входа в систему:</p>
      <a href="{link}" style="display:inline-block;background:#1F5C8B;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:16px">
        Войти в систему
      </a>
      <p style="color:#6B7280;font-size:12px;margin-top:24px">
        Ссылка действительна 30 минут. Если вы не запрашивали вход — проигнорируйте письмо.
      </p>
    </div>
    """
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, email, msg.as_string())
        return True, link
    except Exception as e:
        print(f"Email send error: {e}")
        return False, link

def create_magic_token(email: str, db) -> str:
    token = secrets.token_urlsafe(32)
    db.add(MagicToken(
        token=token,
        email=email.lower().strip(),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=30)
    ))
    db.commit()
    return token

def verify_magic_token(token: str, db) -> str | None:
    """Verify token, return email if valid"""
    mt = db.query(MagicToken).filter_by(token=token, used=False).first()
    if not mt:
        return None
    if datetime.now(timezone.utc) > mt.expires_at.replace(tzinfo=timezone.utc):
        return None
    mt.used = True
    db.commit()
    return mt.email

def get_or_create_user(email: str, db) -> User:
    email = email.lower().strip()
    user = db.query(User).filter_by(email=email).first()
    now = datetime.now(timezone.utc)
    if not user:
        role = "admin" if is_admin_email(email) else "free"
        effective_limit = -1 if role == "admin" else TRIAL_TZ_COUNT
        trial_exp = now + timedelta(days=TRIAL_DAYS)
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            role=role,
            plan="admin" if role == "admin" else "trial",
            tz_limit=effective_limit,
            trial_ends_at=trial_exp,
        )
        db.add(user)
        db.flush()
    else:
        # Backfill trial_ends_at if missing
        if not user.trial_ends_at and user.role == "free":
            ref = user.created_at or now
            if getattr(ref, "tzinfo", None) is None:
                ref = ref.replace(tzinfo=timezone.utc)
            user.trial_ends_at = ref + timedelta(days=TRIAL_DAYS)
        # Backfill plan if missing
        if not getattr(user, "plan", None):
            user.plan = _get_effective_plan(user)
    if sync_user_entitlements(user):
        db.flush()
    user.last_login = now
    db.commit()
    return user

def create_jwt(email: str, role: str) -> str:
    payload = {
        "sub": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        return None


# ── Password auth (super admin) ───────────────────────────────────────────

SUPERADMIN_USERNAME = os.getenv("SUPERADMIN_USERNAME", "").strip()
SUPERADMIN_PASSWORD = os.getenv("SUPERADMIN_PASSWORD", "").strip()
SUPERADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL", "").strip() or (list(ADMIN_EMAILS)[0] if ADMIN_EMAILS else "admin@tz-generator.ru")


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-SHA256 with random salt."""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260000)
    return f"pbkdf2:sha256:260000${salt}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify password against PBKDF2-SHA256 hash."""
    if not password_hash or "$" not in password_hash:
        return False
    try:
        parts = password_hash.split("$")
        if len(parts) != 3:
            return False
        salt = parts[1]
        stored_hash = parts[2]
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 260000)
        return secrets.compare_digest(dk.hex(), stored_hash)
    except Exception:
        return False


def authenticate_superadmin(username: str, password: str, db) -> User | None:
    """
    Authenticate super admin by username/password.
    Checks env-configured credentials first, then DB-stored password_hash.
    """
    # Method 1: env-configured super admin (primary)
    if SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD:
        if username == SUPERADMIN_USERNAME and password == SUPERADMIN_PASSWORD:
            user = get_or_create_user(SUPERADMIN_EMAIL, db)
            user.role = "admin"
            user.tz_limit = -1
            if not user.username:
                user.username = username
            if not user.password_hash:
                user.password_hash = hash_password(password)
            db.commit()
            return user

    # Method 2: DB-stored credentials
    user = db.query(User).filter_by(username=username).first()
    if user and user.password_hash and verify_password(password, user.password_hash):
        user.last_login = datetime.now(timezone.utc)
        db.commit()
        return user

    return None
