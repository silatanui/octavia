from datetime import time

from sqlalchemy import ForeignKey, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Shift(Base):
    __tablename__ = "shifts"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), nullable=False)
    shift_name: Mapped[str] = mapped_column(String(64), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    site: Mapped["Site"] = relationship(back_populates="shifts")  # type: ignore[name-defined]
