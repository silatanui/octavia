from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.production import ProductionRecord, ShiftNote
from app.models.user import User
from app.models.work_order import WorkOrder
from app.schemas.common import ProductionCreate, ProductionOut, ShiftNoteCreate
from app.services.audit import log_action

router = APIRouter(tags=["production"])


@router.get("/production", response_model=list[ProductionOut])
def list_production(
    machine_id: int | None = None,
    date: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(ProductionRecord)
    if machine_id:
        q = q.where(ProductionRecord.machine_id == machine_id)
    if date:
        start = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end = start.replace(hour=23, minute=59, second=59)
        q = q.where(ProductionRecord.recorded_at >= start, ProductionRecord.recorded_at <= end)
    return list(db.scalars(q.order_by(ProductionRecord.recorded_at.desc()).limit(200)).all())


@router.post("/production", response_model=ProductionOut)
def create_production(
    payload: ProductionCreate,
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
    if not data.get("recorded_at"):
        data["recorded_at"] = datetime.now(timezone.utc)
    record = ProductionRecord(**data)
    db.add(record)
    if payload.work_order_id:
        wo = db.get(WorkOrder, payload.work_order_id)
        if wo:
            wo.actual_quantity = (wo.actual_quantity or 0) + payload.total_units
            wo.good_quantity = (wo.good_quantity or 0) + payload.good_units
            wo.rejected_quantity = (wo.rejected_quantity or 0) + payload.rejected_units
            if wo.status in ("Planned", "Ready"):
                wo.status = "In Progress"
                wo.actual_start = wo.actual_start or datetime.now(timezone.utc)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="production_record", entity_id=record.id)
    db.commit()
    db.refresh(record)
    return record


@router.post("/shift-notes")
def create_shift_note(
    payload: ShiftNoteCreate,
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
    note = ShiftNote(
        site_id=payload.site_id,
        shift_id=payload.shift_id,
        note_date=payload.note_date or datetime.now(timezone.utc),
        author_id=user.id,
        content=payload.content,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return {
        "id": note.id,
        "content": note.content,
        "created_at": note.created_at.isoformat() if note.created_at else None,
        "author_id": note.author_id,
    }
