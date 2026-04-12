"""
Email notification service for TZ Generator.

Templates: welcome, trial_warning, trial_expired, payment_success, subscription_warning.
Sending via SMTP (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM env vars).
All sends are fire-and-forget via FastAPI BackgroundTasks.
Results are logged to email_log table.
"""

from __future__ import annotations

import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

logger = logging.getLogger(__name__)

# ── SMTP config ────────────────────────────────────────────────────────────
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)

APP_URL = os.getenv("APP_URL", "https://tz-generator-frontend.onrender.com/react/")
PRICING_URL = os.getenv("PRICING_URL", f"{APP_URL.rstrip('/')}/#pricing")

# ── Email templates ────────────────────────────────────────────────────────
_TEMPLATES: dict[str, dict[str, str]] = {
    "welcome": {
        "subject": "Добро пожаловать — у вас 3 ТЗ бесплатно",
        "text": """\
Здравствуйте, {name}!

Ваш триал активирован: 3 ТЗ, 14 дней.

Начать работу: {app_url}

С уважением,
Команда TZ Generator
""",
        "html": """\
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;">
<h2 style="color:#2563eb;">Добро пожаловать в TZ Generator!</h2>
<p>Здравствуйте, <strong>{name}</strong>!</p>
<p>Ваш триал активирован: <strong>3 ТЗ, 14 дней</strong>.</p>
<p><a href="{app_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Начать работу</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:12px;color:#94a3b8;">TZ Generator — генератор ТЗ для госзакупок 44-ФЗ/223-ФЗ</p>
</body></html>
""",
    },
    "trial_warning": {
        "subject": "Осталось 3 дня бесплатного доступа",
        "text": """\
Здравствуйте!

Ваш триал завершается {date}.
Использовано {used} из 3 ТЗ.

Выберите тариф, чтобы продолжить: {pricing_url}

С уважением,
Команда TZ Generator
""",
        "html": """\
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;">
<h2 style="color:#d97706;">⏳ Осталось 3 дня бесплатного доступа</h2>
<p>Ваш триал завершается <strong>{date}</strong>.</p>
<p>Использовано <strong>{used} из 3</strong> ТЗ.</p>
<p><a href="{pricing_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Выбрать тариф</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:12px;color:#94a3b8;">TZ Generator — генератор ТЗ для госзакупок 44-ФЗ/223-ФЗ</p>
</body></html>
""",
    },
    "trial_expired": {
        "subject": "Пробный период завершён",
        "text": """\
Здравствуйте!

Ваш бесплатный период завершён.
Все созданные ТЗ сохранены в истории.

Выберите тариф: {pricing_url}

С уважением,
Команда TZ Generator
""",
        "html": """\
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;">
<h2 style="color:#ef4444;">Пробный период завершён</h2>
<p>Ваш бесплатный период завершён.</p>
<p>Все созданные ТЗ сохранены в истории.</p>
<p><a href="{pricing_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Выбрать тариф</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:12px;color:#94a3b8;">TZ Generator — генератор ТЗ для госзакупок 44-ФЗ/223-ФЗ</p>
</body></html>
""",
    },
    "payment_success": {
        "subject": "Тариф {plan_name} активирован",
        "text": """\
Здравствуйте!

Оплата прошла успешно.
Тариф: {plan_name}
Действует до: {expires_date}

Личный кабинет: {app_url}

С уважением,
Команда TZ Generator
""",
        "html": """\
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;">
<h2 style="color:#16a34a;">✅ Тариф {plan_name} активирован</h2>
<p>Оплата прошла успешно.</p>
<table style="border-collapse:collapse;margin:16px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Тариф</td><td><strong>{plan_name}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Действует до</td><td><strong>{expires_date}</strong></td></tr>
</table>
<p><a href="{app_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Перейти в личный кабинет</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:12px;color:#94a3b8;">TZ Generator — генератор ТЗ для госзакупок 44-ФЗ/223-ФЗ</p>
</body></html>
""",
    },
    "subscription_warning": {
        "subject": "Подписка истекает через 5 дней",
        "text": """\
Здравствуйте!

Ваша подписка {plan_name} заканчивается {date}.

Продлить: {pricing_url}

С уважением,
Команда TZ Generator
""",
        "html": """\
<html><body style="font-family:Arial,sans-serif;color:#1e293b;line-height:1.6;">
<h2 style="color:#d97706;">⚠️ Подписка истекает через 5 дней</h2>
<p>Ваша подписка <strong>{plan_name}</strong> заканчивается <strong>{date}</strong>.</p>
<p><a href="{pricing_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Продлить подписку</a></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
<p style="font-size:12px;color:#94a3b8;">TZ Generator — генератор ТЗ для госзакупок 44-ФЗ/223-ФЗ</p>
</body></html>
""",
    },
}

_PLAN_DISPLAY_NAMES: dict[str, str] = {
    "trial": "Триал",
    "start": "Старт",
    "base": "Базовый",
    "team": "Команда",
    "corp": "Корпоратив",
    "pro": "Pro",
    "admin": "Admin",
}


def plan_display_name(plan: str) -> str:
    return _PLAN_DISPLAY_NAMES.get(plan.lower(), plan.capitalize())


def _is_smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)


def _send_smtp(to: str, subject: str, text_body: str, html_body: str) -> None:
    """Send email via SMTP. Raises on failure."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    use_ssl = SMTP_PORT == 465
    timeout = 10

    if use_ssl:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=timeout) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=timeout) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, to, msg.as_string())


def _log_email(db: Any, user_id: str | None, template: str, success: bool, error: str | None) -> None:
    """Write a row to email_log table. Safe — never raises."""
    try:
        from database import EmailLog  # type: ignore[import]
    except ImportError:
        try:
            from .database import EmailLog  # type: ignore[import]
        except ImportError:
            logger.warning("EmailLog model not available, skipping log write")
            return
    try:
        row = EmailLog(
            user_id=user_id,
            template=template,
            sent_at=datetime.now(timezone.utc),
            success=success,
            error=error,
        )
        db.add(row)
        db.commit()
    except Exception as exc:
        logger.warning(f"[email_service] Failed to write email_log: {exc}")


def send_email(to: str, template: str, data: dict[str, Any], db: Any = None, user_id: str | None = None) -> None:
    """
    Send a templated email.
    Fills in default values for {app_url} and {pricing_url}.
    Logs result to email_log table (if db provided).
    """
    tmpl = _TEMPLATES.get(template)
    if tmpl is None:
        logger.error(f"[email_service] Unknown template: {template!r}")
        return

    # Inject defaults
    ctx = {
        "app_url": APP_URL,
        "pricing_url": PRICING_URL,
        "name": to.split("@")[0],
        **data,
    }

    try:
        subject = tmpl["subject"].format(**ctx)
        text_body = tmpl["text"].format(**ctx)
        html_body = tmpl["html"].format(**ctx)
    except KeyError as e:
        logger.error(f"[email_service] Missing template variable {e} for template={template!r}")
        if db:
            _log_email(db, user_id, template, False, f"Missing variable: {e}")
        return

    if not _is_smtp_configured():
        logger.info(
            f"[email_service] SMTP not configured — would send template={template!r} to={to!r}; subject={subject!r}"
        )
        if db:
            _log_email(db, user_id, template, False, "SMTP not configured")
        return

    try:
        _send_smtp(to, subject, text_body, html_body)
        logger.info(f"[email_service] Sent template={template!r} to={to!r}")
        if db:
            _log_email(db, user_id, template, True, None)
    except Exception as exc:
        logger.error(f"[email_service] Failed to send template={template!r} to={to!r}: {exc}")
        if db:
            _log_email(db, user_id, template, False, str(exc)[:500])


def send_email_bg(
    to: str,
    template: str,
    data: dict[str, Any],
    db_factory: Any = None,
    user_id: str | None = None,
) -> None:
    """
    Version for BackgroundTasks: opens its own DB session so we don't hold
    the request session open during SMTP.
    """
    db = None
    try:
        if db_factory is not None:
            db = next(db_factory())
        send_email(to, template, data, db=db, user_id=user_id)
    except Exception as exc:
        logger.error(f"[email_service] Background send error: {exc}")
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
