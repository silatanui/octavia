from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class DowntimeCategory(Base):
    __tablename__ = "downtime_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    planned_or_unplanned: Mapped[str] = mapped_column(String(20), default="unplanned")


class DowntimeEvent(Base):
    __tablename__ = "downtime_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("downtime_categories.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(String(255))
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="Open")
    notes: Mapped[str | None] = mapped_column(Text)
    corrective_action: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    machine: Mapped["Machine"] = relationship()  # type: ignore[name-defined]
    category: Mapped["DowntimeCategory | None"] = relationship()
    reporter: Mapped["User | None"] = relationship(foreign_keys=[reported_by])  # type: ignore[name-defined]
    verifier: Mapped["User | None"] = relationship(foreign_keys=[verified_by])  # type: ignore[name-defined]
