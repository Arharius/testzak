import os, uuid, secrets, smtplib
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

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.yandex.ru")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_TIMEOUT = int(os.getenv("SMTP_TIMEOUT", "10"))
APP_URL = os.getenv("APP_URL", "https://tz-generator.onrender.com")

def _safe_int(value: str, default: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default

FREE_TZ_LIMIT = _safe_int(os.getenv("FREE_TZ_LIMIT", "3"), 3)

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
        desired_limit = max(1, FREE_TZ_LIMIT)
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
    if not user:
        role = "admin" if is_admin_email(email) else "free"
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            role=role,
            tz_limit=-1 if role == "admin" else max(1, FREE_TZ_LIMIT)
        )
        db.add(user)
        db.flush()
    if sync_user_entitlements(user):
        db.flush()
    user.last_login = datetime.now(timezone.utc)
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
