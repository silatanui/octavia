from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Machine(Base):
    __tablename__ = "machines"

    id: Mapped[int] = mapped_column(primary_key=True)
    production_line_id: Mapped[int] = mapped_column(ForeignKey("production_lines.id"), nullable=False)
    machine_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    machine_name: Mapped[str] = mapped_column(String(120), nullable=False)
    machine_type: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32), default="Offline")
    active: Mapped[bool] = mapped_column(default=True)
    last_update_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status_source: Mapped[str] = mapped_column(String(32), default="demo")

    production_line: Mapped["ProductionLine"] = relationship(back_populates="machines")  # type: ignore[name-defined]
    events: Mapped[list["MachineEvent"]] = relationship(back_populates="machine")


class MachineEvent(Base):
    __tablename__ = "machine_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(32), default="demo")
    event_reference: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    machine: Mapped["Machine"] = relationship(back_populates="events")
