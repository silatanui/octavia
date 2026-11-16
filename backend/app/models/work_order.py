from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    machine_id: Mapped[int | None] = mapped_column(ForeignKey("machines.id"), index=True)
    planned_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    actual_quantity: Mapped[float] = mapped_column(Float, default=0)
    good_quantity: Mapped[float] = mapped_column(Float, default=0)
    rejected_quantity: Mapped[float] = mapped_column(Float, default=0)
    planned_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    planned_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    customer_ref: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="Planned")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    product: Mapped["Product"] = relationship()  # type: ignore[name-defined]
    machine: Mapped["Machine | None"] = relationship()  # type: ignore[name-defined]
