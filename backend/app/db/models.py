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
    text,
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
        CheckConstraint("username ~ '^[a-z0-9_]{3,20}$'", name="username_format"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True)
    # Public handle used to find friends. Generated at registration, changeable in Settings.
    username: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    username_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
        # A user saves at most one workout per shared-session round.
        Index("uq_workout_sessions_user_shared", "user_id", "shared_session_id", unique=True,
              postgresql_where=text("shared_session_id is not null")),
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
    # Set when this individual workout was done as part of a shared session.
    shared_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("shared_sessions.id", ondelete="SET NULL")
    )


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
    buddy_reminder_24h: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
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


# ---------------------------------------------------------------- SabiBody Buddies
# Relationships between two users are stored once per pair with
# user_low < user_high (UUID ordering), so a pair can never be duplicated.

def _pair_low() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


def _pair_high() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


def _pair_check() -> CheckConstraint:
    return CheckConstraint("user_low < user_high", name="pair_ordered")


def _user_ref(index: bool = False, ondelete: str = "CASCADE", nullable: bool = False) -> Mapped:
    return mapped_column(Uuid, ForeignKey("users.id", ondelete=ondelete), nullable=nullable, index=index)


def _updated_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class Friendship(Base):
    """A friend request (pending) or an accepted friendship. Declined/cancelled requests are deleted."""

    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low", "user_high", name="uq_friendships_pair"),
        _pair_check(),
        CheckConstraint("status in ('pending', 'accepted')", name="status_valid"),
        CheckConstraint("requester_id in (user_low, user_high)", name="requester_in_pair"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    requester_id: Mapped[uuid.UUID] = _user_ref()
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending", default="pending")
    created_at: Mapped[datetime] = _created_at()
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FriendRequestEvent(Base):
    """History of sent/declined/cancelled requests, used for daily limits and re-request cooldowns."""

    __tablename__ = "friend_request_events"
    __table_args__ = (
        CheckConstraint("outcome in ('sent', 'declined', 'cancelled')", name="outcome_valid"),
        Index("ix_friend_request_events_requester_created", "requester_id", "created_at"),
        Index("ix_friend_request_events_pair", "requester_id", "target_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    requester_id: Mapped[uuid.UUID] = _user_ref()
    target_id: Mapped[uuid.UUID] = _user_ref(index=True)
    outcome: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class UserBlock(Base):
    __tablename__ = "user_blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_user_blocks_pair"),
        CheckConstraint("blocker_id <> blocked_id", name="not_self"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    blocker_id: Mapped[uuid.UUID] = _user_ref()
    blocked_id: Mapped[uuid.UUID] = _user_ref(index=True)
    created_at: Mapped[datetime] = _created_at()


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("user_low", "user_high", name="uq_conversations_pair"), _pair_check())

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("sender_id", "client_msg_id", name="uq_messages_sender_client_id"),
        CheckConstraint(
            "kind in ('text', 'exercise_card', 'invitation', 'scheduled_workout', 'nudge', 'system')",
            name="kind_valid",
        ),
        CheckConstraint("char_length(body) <= 2000", name="body_length"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("conversations.id", ondelete="CASCADE"),
                                                       nullable=False)
    sender_id: Mapped[uuid.UUID] = _user_ref()
    kind: Mapped[str] = mapped_column(String(20), nullable=False, server_default="text", default="text")
    body: Mapped[str] = mapped_column(Text, nullable=False, server_default="", default="")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    client_msg_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class ConversationRead(Base):
    __tablename__ = "conversation_reads"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class UserReport(Base):
    __tablename__ = "user_reports"
    __table_args__ = (
        CheckConstraint(
            "reason in ('spam', 'harassment', 'inappropriate', 'impersonation', 'other')", name="reason_valid"
        ),
        CheckConstraint("status in ('open', 'reviewed')", name="status_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    reporter_id: Mapped[uuid.UUID | None] = _user_ref(index=True, ondelete="SET NULL", nullable=True)
    reported_id: Mapped[uuid.UUID | None] = _user_ref(index=True, ondelete="SET NULL", nullable=True)
    reported_username: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    details: Mapped[str | None] = mapped_column(String(1000))
    message_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("messages.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="open", default="open")
    created_at: Mapped[datetime] = _created_at()


class FriendMute(Base):
    """Mutes notifications (not messages) from one friend."""

    __tablename__ = "friend_mutes"
    __table_args__ = (UniqueConstraint("user_id", "muted_user_id", name="uq_friend_mutes_pair"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_ref()
    muted_user_id: Mapped[uuid.UUID] = _user_ref(index=True)
    created_at: Mapped[datetime] = _created_at()


SESSION_STATUSES = ("proposed", "accepted", "live", "completed", "incomplete", "declined", "cancelled", "expired")


class SharedSession(Base):
    """A workout two friends agreed (or were invited) to do together.

    mode='instant' is an invitation to work out now; mode='scheduled' is a
    calendar commitment. Repeat rounds link to their first round via root_session_id.
    """

    __tablename__ = "shared_sessions"
    __table_args__ = (
        _pair_check(),
        CheckConstraint("mode in ('instant', 'scheduled')", name="mode_valid"),
        CheckConstraint("status in (" + ", ".join("'" + s + "'" for s in SESSION_STATUSES) + ")",
                        name="status_valid"),
        CheckConstraint("exercise_type in ('reps', 'duration')", name="exercise_type_valid"),
        CheckConstraint(
            "(exercise_type = 'reps' and target_reps > 0 and target_duration_seconds is null) or "
            "(exercise_type = 'duration' and target_duration_seconds > 0 and target_reps is null)",
            name="target_matches_type",
        ),
        CheckConstraint("mode = 'instant' or scheduled_at is not null", name="scheduled_has_time"),
        CheckConstraint("round_number >= 1", name="round_positive"),
        # One open instant invitation per pair, and one commitment per pair at a given moment.
        Index("uq_shared_sessions_open_instant", "user_low", "user_high", unique=True,
              postgresql_where=text("mode = 'instant' and status = 'proposed'")),
        Index("uq_shared_sessions_pair_time", "user_low", "user_high", "scheduled_at", unique=True,
              postgresql_where=text("mode = 'scheduled' and status in ('proposed', 'accepted')")),
        Index("ix_shared_sessions_status_scheduled", "status", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    created_by: Mapped[uuid.UUID] = _user_ref()
    exercise_id: Mapped[str] = mapped_column(String(40), nullable=False)
    exercise_type: Mapped[str] = mapped_column(String(16), nullable=False)
    target_reps: Mapped[int | None] = mapped_column(Integer)
    target_duration_seconds: Mapped[int | None] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String(10), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default="proposed", default="proposed")
    awaiting_user_id: Mapped[uuid.UUID | None] = _user_ref(ondelete="SET NULL", nullable=True)
    message: Mapped[str | None] = mapped_column(String(280))
    root_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("shared_sessions.id", ondelete="SET NULL"), index=True
    )
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[uuid.UUID | None] = _user_ref(ondelete="SET NULL", nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()


class SharedSessionParticipant(Base):
    __tablename__ = "shared_session_participants"
    __table_args__ = (
        CheckConstraint("rsvp in ('pending', 'accepted', 'declined')", name="rsvp_valid"),
        CheckConstraint(
            "outcome is null or outcome in ('completed', 'not_completed', 'disconnected', 'absent')",
            name="outcome_valid",
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shared_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True,
                                               index=True)
    rsvp: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending", default="pending")
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    left_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(String(15))
    workout_session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("workout_sessions.id", ondelete="SET NULL")
    )


class SharedSessionEvent(Base):
    __tablename__ = "shared_session_events"

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("shared_sessions.id", ondelete="CASCADE"),
                                                  nullable=False, index=True)
    actor_id: Mapped[uuid.UUID | None] = _user_ref(ondelete="SET NULL", nullable=True)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = _created_at()


class SharedReminderDeliveryLog(Base):
    """One row per (session, user, reminder kind, scheduled time): prevents duplicate buddy emails.

    The scheduled_at snapshot means a reschedule re-arms the reminders for the new time.
    """

    __tablename__ = "shared_reminder_delivery_logs"
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", "kind", "scheduled_at", name="uq_shared_reminder_once"),
        CheckConstraint("kind in ('24h', '1h', 'start')", name="kind_valid"),
        CheckConstraint("delivery_status in ('pending', 'sent', 'failed', 'skipped')", name="delivery_status_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("shared_sessions.id", ondelete="CASCADE"),
                                                  nullable=False)
    user_id: Mapped[uuid.UUID] = _user_ref(index=True)
    kind: Mapped[str] = mapped_column(String(6), nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(10), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = _created_at()


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_dedupe"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _user_ref()
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = _user_ref(ondelete="SET NULL", nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(30))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class NotificationPreference(Base):
    """Per-type overrides. A missing row means the type's default."""

    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    type: Mapped[str] = mapped_column(String(40), primary_key=True)
    in_app: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true", default=True)
    email: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true", default=True)


class BuddyStreak(Base):
    __tablename__ = "buddy_streaks"
    __table_args__ = (UniqueConstraint("user_low", "user_high", name="uq_buddy_streaks_pair"), _pair_check())

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    current: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    longest: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    total_completed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    last_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    run_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = _updated_at()


class ExerciseStreak(Base):
    __tablename__ = "exercise_streaks"
    __table_args__ = (
        UniqueConstraint("user_low", "user_high", "exercise_id", name="uq_exercise_streaks_pair_exercise"),
        _pair_check(),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    exercise_id: Mapped[str] = mapped_column(String(40), nullable=False)
    current: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    longest: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    total_completed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    last_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    run_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = _updated_at()


class StreakEvent(Base):
    """Idempotency ledger: each commitment (root session) affects streaks exactly once."""

    __tablename__ = "streak_events"
    __table_args__ = (CheckConstraint("outcome in ('counted', 'broken', 'neutral')", name="outcome_valid"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    root_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shared_sessions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    user_low: Mapped[uuid.UUID] = _pair_low()
    user_high: Mapped[uuid.UUID] = _pair_high()
    exercise_id: Mapped[str] = mapped_column(String(40), nullable=False)
    outcome: Mapped[str] = mapped_column(String(10), nullable=False)
    reason: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = _created_at()


class Challenge(Base):
    """A one-to-one challenge. Progress is always computed from real workout rows."""

    __tablename__ = "challenges"
    __table_args__ = (
        CheckConstraint("creator_id <> opponent_id", name="not_self"),
        CheckConstraint(
            "status in ('pending', 'active', 'declined', 'cancelled', 'completed', 'expired')", name="status_valid"
        ),
        CheckConstraint("target_total > 0", name="target_positive"),
        CheckConstraint("metric in ('reps', 'seconds', 'workouts')", name="metric_valid"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    creator_id: Mapped[uuid.UUID] = _user_ref(index=True)
    opponent_id: Mapped[uuid.UUID] = _user_ref(index=True)
    # An exercise id, or 'any' for "complete N workouts".
    exercise_id: Mapped[str] = mapped_column(String(40), nullable=False)
    # reps: total reps of the exercise; seconds: longest single plank hold; workouts: completed workouts.
    metric: Mapped[str] = mapped_column(String(10), nullable=False)
    target_total: Mapped[int] = mapped_column(Integer, nullable=False)
    deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    message: Mapped[str | None] = mapped_column(String(280))
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending", default="pending")
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
