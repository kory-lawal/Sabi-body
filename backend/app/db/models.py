"""SQLAlchemy models for SabiBody's Neon PostgreSQL database.

Ownership is enforced by the API (every query is scoped to the authenticated
user's id) and backed by foreign keys, unique constraints and checks here.
"""
import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    pass


Base.metadata.naming_convention = NAMING_CONVENTION


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


def _user_fk(unique: bool = False) -> Mapped[uuid.UUID]:
    return mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=unique,
        index=not unique,
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("char_length(full_name) between 1 and 120", name="full_name_length"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true", default=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    admin_role: Mapped["AdminRole | None"] = relationship(back_populates="user", uselist=False)
    reminder_preferences: Mapped["ReminderPreference | None"] = relationship(back_populates="user", uselist=False)


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_workout_sessions_user_idempotency"),
        CheckConstraint("exercise_type in ('reps', 'duration')", name="exercise_type_valid"),
        CheckConstraint("completed_reps is null or completed_reps >= 0", name="completed_reps_non_negative"),
        CheckConstraint("target_reps is null or target_reps > 0", name="target_reps_positive"),
        CheckConstraint(
            "target_duration_seconds is null or target_duration_seconds > 0",
            name="target_duration_positive",
        ),
        CheckConstraint("duration_seconds >= 0", name="duration_non_negative"),
        CheckConstraint("(not completed) or completed_at is not null", name="completed_has_timestamp"),
        Index("ix_workout_sessions_user_started", "user_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    exercise_id: Mapped[str] = mapped_column(String(40), nullable=False)
    exercise_name: Mapped[str] = mapped_column(String(80), nullable=False)
    exercise_type: Mapped[str] = mapped_column(String(16), nullable=False)
    completed_reps: Mapped[int | None] = mapped_column(Integer)
    target_reps: Mapped[int | None] = mapped_column(Integer)
    target_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)


class ReminderPreference(Base):
    __tablename__ = "reminder_preferences"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_fk(unique=True)
    email_reminders_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    morning_reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    morning_reminder_time: Mapped[time] = mapped_column(Time, nullable=False, server_default="07:00", default=time(7, 0))
    evening_reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    evening_reminder_time: Mapped[time] = mapped_column(Time, nullable=False, server_default="18:00", default=time(18, 0))
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="UTC", default="UTC")
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="reminder_preferences")


class EmailVerificationToken(Base):
    """Single-use email tokens; only the SHA-256 hash of the token is stored."""

    __tablename__ = "email_verification_tokens"
    __table_args__ = (
        CheckConstraint("purpose in ('verify_email', 'change_email')", name="purpose_valid"),
        CheckConstraint("purpose = 'verify_email' or new_email is not null", name="change_has_email"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, server_default="verify_email", default="verify_email")
    new_email: Mapped[str | None] = mapped_column(String(254))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class RefreshSession(Base):
    """One row per refresh token. Rotation revokes the old row and inserts a new one."""

    __tablename__ = "refresh_sessions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_fk()
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    remember: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true", default=True)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # rotated | logout | logout_all | password_changed | password_reset | reuse_detected | account_deleted
    revoked_reason: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = _created_at()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReminderDeliveryLog(Base):
    __tablename__ = "reminder_delivery_logs"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "reminder_type", "scheduled_date", name="uq_reminder_delivery_once_per_day"
        ),
        CheckConstraint("reminder_type in ('morning', 'evening')", name="reminder_type_valid"),
        CheckConstraint(
            "delivery_status in ('pending', 'sent', 'failed', 'skipped_completed')",
            name="delivery_status_valid",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    reminder_type: Mapped[str] = mapped_column(String(10), nullable=False)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)
    scheduled_time: Mapped[time] = mapped_column(Time, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivery_status: Mapped[str] = mapped_column(String(20), nullable=False)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = _created_at()


class AdminRole(Base):
    __tablename__ = "admin_roles"
    __table_args__ = (CheckConstraint("role in ('admin')", name="role_valid"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_fk(unique=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="admin", default="admin")
    granted_via: Mapped[str] = mapped_column(String(40), nullable=False, server_default="cli", default="cli")
    created_at: Mapped[datetime] = _created_at()

    user: Mapped[User] = relationship(back_populates="admin_role")


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = _created_at()
