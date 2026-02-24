from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    tenant_id = Column(String, index=True, nullable=False, default="default")
    role = Column(String, nullable=False, default="manager")
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    documents = relationship("TZDocument", back_populates="owner")


class TZDocument(Base):
    __tablename__ = "tz_documents"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    tenant_id = Column(String, index=True, nullable=False, default="default")
    title = Column(String, nullable=False)
    metadata_json = Column(Text, default="{}")
    products_json = Column(Text, default="[]")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    owner = relationship("User", back_populates="documents")


class IntegrationEventLog(Base):
    __tablename__ = "integration_event_log"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(String, index=True, nullable=False, default="default")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    event_name = Column(String, index=True, nullable=False)
    payload_json = Column(Text, default="{}")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TenantSubscription(Base):
    __tablename__ = "tenant_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(String, unique=True, index=True, nullable=False)
    plan_code = Column(String, nullable=False, default="starter")
    status = Column(String, nullable=False, default="active")
    monthly_price_cents = Column(Integer, nullable=False, default=19900)
    billing_cycle = Column(String, nullable=False, default="monthly")
    next_billing_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
