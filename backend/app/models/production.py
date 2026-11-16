from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ProductionRecord(Base):
    __tablename__ = "production_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"), index=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"), index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    total_units: Mapped[float] = mapped_column(Float, default=0)
    good_units: Mapped[float] = mapped_column(Float, default=0)
    rejected_units: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    work_order: Mapped["WorkOrder | None"] = relationship()  # type: ignore[name-defined]
    machine: Mapped["Machine"] = relationship()  # type: ignore[name-defined]
    shift: Mapped["Shift | None"] = relationship()  # type: ignore[name-defined]


class QualityRecord(Base):
    __tablename__ = "quality_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"), index=True)
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"))
    inspected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    good_units: Mapped[float] = mapped_column(Float, default=0)
    rejected_units: Mapped[float] = mapped_column(Float, default=0)
    defect_category: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
    corrective_action: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    machine: Mapped["Machine"] = relationship()  # type: ignore[name-defined]
    work_order: Mapped["WorkOrder | None"] = relationship()  # type: ignore[name-defined]


class ShiftNote(Base):
    __tablename__ = "shift_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("sites.id"))
    shift_id: Mapped[int | None] = mapped_column(ForeignKey("shifts.id"))
    note_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    author: Mapped["User | None"] = relationship()  # type: ignore[name-defined]
