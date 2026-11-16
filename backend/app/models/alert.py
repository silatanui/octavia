from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_id: Mapped[int | None] = mapped_column(ForeignKey("machines.id"), index=True)
    alert_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), default="medium")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32), default="Open")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_notes: Mapped[str | None] = mapped_column(Text)

    machine: Mapped["Machine | None"] = relationship()  # type: ignore[name-defined]
    assignee: Mapped["User | None"] = relationship()  # type: ignore[name-defined]
    action_items: Mapped[list["ActionItem"]] = relationship(back_populates="alert")


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), default="Open")
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    alert: Mapped["Alert | None"] = relationship(back_populates="action_items")
    owner: Mapped["User | None"] = relationship()  # type: ignore[name-defined]
