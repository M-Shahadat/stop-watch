import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Date, DateTime, Integer, UniqueConstraint, func, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#1a6cff")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # status: "running" | "paused" | "completed"
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")

    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Start of the current active segment; null when paused or completed.
    segment_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
        default=lambda: datetime.now(timezone.utc),
    )

    # Seconds from all previous running segments.
    accumulated_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # When the current pause started (null if not currently paused).
    pause_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Seconds from all completed pause periods.
    accumulated_paused_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_adjustment_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    category: Mapped["Category | None"] = relationship("Category", lazy="joined")


class TaskInterval(Base):
    """A completed running segment, used for accurate daily totals."""

    __tablename__ = "task_intervals"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)


class DaySettings(Base):
    __tablename__ = "day_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False, default="00:00")
    end_time: Mapped[str] = mapped_column(String(5), nullable=False, default="00:00")


class DaySettingsVersion(Base):
    """Hours used by tracking days starting on or after effective_date."""

    __tablename__ = "day_settings_versions"

    effective_date: Mapped[date] = mapped_column(Date, primary_key=True)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)


class DailyReset(Base):
    __tablename__ = "daily_resets"
    __table_args__ = (UniqueConstraint("day", "timezone_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(100), nullable=False)
    reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
