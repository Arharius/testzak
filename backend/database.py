from sqlalchemy import create_engine, Column, String, Boolean, Integer, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, timezone
import os

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./tz_generator.db")
# Railway PostgreSQL fix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, index=True)
    username = Column(String, unique=True, nullable=True, index=True)
    password_hash = Column(String, nullable=True)
    role = Column(String, default="free")  # free | pro | admin
    plan = Column(String, default="trial")  # trial | start | base | team | pilot | corp
    tz_count = Column(Integer, default=0)
    tz_limit = Column(Integer, default=0)
    tz_month_start = Column(DateTime, nullable=True)
    trial_ends_at = Column(DateTime, nullable=True)
    trial_started_at = Column(DateTime, nullable=True)  # when trial started
    subscription_id = Column(String, nullable=True)
    subscription_until = Column(DateTime, nullable=True)
    org_id = Column(String, nullable=True, index=True)  # FK to owner user.id for team plans
    org_role = Column(String, nullable=True, default="member")  # owner | member
    llm_provider = Column(String, nullable=True)
    llm_model = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, nullable=True)

class MagicToken(Base):
    __tablename__ = "magic_tokens"
    token = Column(String, primary_key=True)
    email = Column(String, index=True)
    expires_at = Column(DateTime)
    used = Column(Boolean, default=False)

class TZDocument(Base):
    __tablename__ = "tz_documents"
    id = Column(String, primary_key=True)
    user_email = Column(String, index=True)
    title = Column(String)
    goods_type = Column(String)
    model = Column(String)
    specs_json = Column(Text)
    # Extended fields for full TZ state
    law_mode = Column(String, default="44")  # '44' or '223'
    rows_json = Column(Text, nullable=True)  # Full rows state: [{type, model, qty, specs, meta}]
    compliance_score = Column(Integer, nullable=True)
    readiness_json = Column(Text, nullable=True)
    publication_dossier_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class IntegrationState(Base):
    __tablename__ = "integration_state"
    id = Column(Integer, primary_key=True, default=1)
    queue_json = Column(Text, default="[]")
    history_json = Column(Text, default="[]")
    enterprise_status_json = Column(Text, default="[]")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class IntegrationAuditLog(Base):
    __tablename__ = "integration_audit_log"
    id = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(String, nullable=False)
    action = Column(String, nullable=False)
    status = Column(String, nullable=False)
    record_id = Column(String, nullable=True)
    note = Column(String, nullable=True)
    payload_json = Column(Text, default="{}")


class IntegrationIdempotencyKey(Base):
    __tablename__ = "integration_idempotency_keys"
    idem_key = Column(String, primary_key=True)
    created_at = Column(String, nullable=False)
    response_json = Column(Text, nullable=False)


class ImmutableAuditChain(Base):
    __tablename__ = "immutable_audit_chain"
    id = Column(Integer, primary_key=True, autoincrement=True)
    at = Column(String, nullable=False)
    action = Column(String, nullable=False)
    payload_json = Column(Text, nullable=False)
    prev_hash = Column(String, nullable=False)
    hash = Column(String, nullable=False)

class Generation(Base):
    __tablename__ = "generations"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(String, nullable=True, index=True)
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    title       = Column(String, nullable=False, default="")
    source_type = Column(String, nullable=False, default="text")  # text|docx|price|fix
    text        = Column(Text, nullable=True)
    docx_path   = Column(String, nullable=True)
    qa_score    = Column(Integer, nullable=True)
    word_count  = Column(Integer, nullable=True, default=0)


class EmailLog(Base):
    __tablename__ = "email_log"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(String, nullable=True, index=True)
    template   = Column(String, nullable=False)
    sent_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    success    = Column(Boolean, default=False)
    error      = Column(String, nullable=True)


class TZValidateLog(Base):
    __tablename__ = "tz_validate_log"
    id             = Column(Integer, primary_key=True, autoincrement=True)
    timestamp      = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    can_export     = Column(Boolean)
    critical_count = Column(Integer, default=0)
    moderate_count = Column(Integer, default=0)
    critical_json  = Column(Text, nullable=True)
    moderate_json  = Column(Text, nullable=True)
    category       = Column(String, nullable=True)


class PilotFeedback(Base):
    __tablename__ = "pilot_feedback"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(String, nullable=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    answers    = Column(Text, nullable=True)  # JSON


class ErrorLog(Base):
    __tablename__ = "error_log"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    timestamp  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    user_id    = Column(String, nullable=True, index=True)
    endpoint   = Column(String, nullable=True)
    error_type = Column(String, nullable=True)
    message    = Column(Text, nullable=True)
    traceback  = Column(Text, nullable=True)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    # Auto-migrate: add columns that may not exist yet
    _auto_migrate()


def _auto_migrate(target_engine=None, target_database_url=None):
    """Add missing columns to existing tables (safe to run multiple times)."""
    from sqlalchemy import inspect, text
    current_engine = target_engine or engine
    current_database_url = target_database_url or DATABASE_URL
    insp = inspect(current_engine)
    is_sqlite = "sqlite" in current_database_url
    if "users" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("users")}
        with current_engine.begin() as conn:
            if "username" not in existing:
                # SQLite cannot add UNIQUE columns; add without UNIQUE, then create index
                if is_sqlite:
                    conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR"))
                    try:
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users(username)"))
                    except Exception:
                        pass
                else:
                    conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR UNIQUE"))
            if "password_hash" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR"))
            if "trial_ends_at" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN trial_ends_at TIMESTAMP"))
            if "llm_provider" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_provider VARCHAR"))
            if "llm_model" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN llm_model VARCHAR"))
            if "plan" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN plan VARCHAR DEFAULT 'trial'"))
            if "trial_started_at" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN trial_started_at TIMESTAMP"))
            if "org_id" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN org_id VARCHAR"))
            if "org_role" not in existing:
                conn.execute(text("ALTER TABLE users ADD COLUMN org_role VARCHAR DEFAULT 'member'"))
    if "tz_documents" in insp.get_table_names():
        existing = {c["name"] for c in insp.get_columns("tz_documents")}
        with current_engine.begin() as conn:
            if "law_mode" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN law_mode VARCHAR DEFAULT '44'"))
            if "rows_json" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN rows_json TEXT"))
            if "compliance_score" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN compliance_score INTEGER"))
            if "readiness_json" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN readiness_json TEXT"))
            if "publication_dossier_json" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN publication_dossier_json TEXT"))
            if "updated_at" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN updated_at TIMESTAMP"))
            if "created_at" not in existing:
                conn.execute(text("ALTER TABLE tz_documents ADD COLUMN created_at TIMESTAMP"))
    # generations table is created automatically by Base.metadata.create_all
    # email_log table is created automatically by Base.metadata.create_all
