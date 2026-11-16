from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

LEAD_ROLES = frozenset({"section_lead", "team_lead"})
MACHINE_ROLES = frozenset({"operator", "junior", "relief"})
ASSIGNMENT_ROLES = LEAD_ROLES | MACHINE_ROLES


class StaffAssignment(Base):
    __tablename__ = "staff_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "work_date", "shift_id", name="uq_staff_user_date_shift"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id"), nullable=False, index=True)
    assignment_role: Mapped[str] = mapped_column(String(32), nullable=False)
    production_line_id: Mapped[int | None] = mapped_column(ForeignKey("production_lines.id"))
    machine_id: Mapped[int | None] = mapped_column(ForeignKey("machines.id"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])  # type: ignore[name-defined]
    creator: Mapped["User | None"] = relationship(foreign_keys=[created_by])  # type: ignore[name-defined]
    shift: Mapped["Shift"] = relationship()  # type: ignore[name-defined]
    production_line: Mapped["ProductionLine | None"] = relationship()  # type: ignore[name-defined]
    machine: Mapped["Machine | None"] = relationship()  # type: ignore[name-defined]
