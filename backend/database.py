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
    role = Column(String, default="free")  # free | pro | admin
    tz_count = Column(Integer, default=0)
    tz_limit = Column(Integer, default=3)  # free = 3/month, pro/admin = -1 (unlimited)
    tz_month_start = Column(DateTime, nullable=True)  # track monthly reset
    subscription_id = Column(String, nullable=True)
    subscription_until = Column(DateTime, nullable=True)
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
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
