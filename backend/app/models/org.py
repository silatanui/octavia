from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str | None] = mapped_column(String(160))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")

    departments: Mapped[list["Department"]] = relationship(back_populates="site")
    shifts: Mapped[list["Shift"]] = relationship(back_populates="site")  # type: ignore[name-defined]


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"), nullable=False)
    department_name: Mapped[str] = mapped_column(String(120), nullable=False)

    site: Mapped["Site"] = relationship(back_populates="departments")
    production_lines: Mapped[list["ProductionLine"]] = relationship(back_populates="department")


class ProductionLine(Base):
    __tablename__ = "production_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"), nullable=False)
    line_name: Mapped[str] = mapped_column(String(120), nullable=False)

    department: Mapped["Department"] = relationship(back_populates="production_lines")
    machines: Mapped[list["Machine"]] = relationship(back_populates="production_line")  # type: ignore[name-defined]
