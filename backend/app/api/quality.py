from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.production import QualityRecord
from app.models.user import User
from app.schemas.common import QualityCreate, QualityOut
from app.services.audit import log_action
from app.services.quality_overview import build_quality_overview

router = APIRouter(prefix="/quality", tags=["quality"])


@router.get("/overview")
def quality_overview(
    days: int = Query(14, ge=1, le=90),
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return build_quality_overview(db, days=days, machine_id=machine_id)


@router.get("", response_model=list[QualityOut])
def list_quality(
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(QualityRecord)
    if machine_id:
        q = q.where(QualityRecord.machine_id == machine_id)
    return list(db.scalars(q.order_by(QualityRecord.inspected_at.desc()).limit(200)).all())


@router.post("", response_model=QualityOut)
def create_quality(
    payload: QualityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(
        require_roles(
            "Administrator",
            "Production Manager",
            "Production Supervisor",
            "Machine Operator",
        )
    ),
):
    data = payload.model_dump()
    if not data.get("inspected_at"):
        data["inspected_at"] = datetime.now(timezone.utc)
    record = QualityRecord(**data)
    db.add(record)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="quality_record", entity_id=record.id)
    db.commit()
    db.refresh(record)
    return record
