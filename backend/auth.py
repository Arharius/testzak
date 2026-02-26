import os, uuid, secrets, smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import jwt
from database import User, MagicToken, get_db

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24 * 30  # 30 days

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.yandex.ru")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
APP_URL = os.getenv("APP_URL", "https://arharius.github.io/testzak")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "Arharius@yandex.ru").lower().strip()

def send_magic_link(email: str, token: str):
    """Send magic link email via Yandex SMTP"""
    link = f"{APP_URL}?magic={token}"
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
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT) as server:
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, email, msg.as_string())
        return True
    except Exception as e:
        print(f"Email send error: {e}")
        return False

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
        role = "admin" if email == ADMIN_EMAIL else "free"
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            role=role,
            tz_limit=-1 if role == "admin" else 3
        )
        db.add(user)
        db.commit()
        db.refresh(user)
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
