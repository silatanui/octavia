from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    product_name: Mapped[str] = mapped_column(String(160), nullable=False)
    ideal_cycle_time: Mapped[float] = mapped_column(Float, default=60.0)  # seconds
    unit_of_measure: Mapped[str] = mapped_column(String(32), default="pcs")
