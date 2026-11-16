from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.downtime import DowntimeCategory, DowntimeEvent
from app.models.machine import Machine
from app.models.user import User
from app.schemas.common import DowntimeCreate, DowntimeOut
from app.services import kpi as kpi_svc
from app.services.audit import log_action
from app.services.stop_catalog import catalog_payload, find_group_for_reason, reason_color

router = APIRouter(prefix="/downtime", tags=["downtime"])


def _to_out(ev: DowntimeEvent) -> DowntimeOut:
    return DowntimeOut(
        id=ev.id,
        machine_id=ev.machine_id,
        work_order_id=ev.work_order_id,
        category_id=ev.category_id,
        started_at=ev.started_at,
        ended_at=ev.ended_at,
        reason=ev.reason,
        status=ev.status,
        notes=ev.notes,
        corrective_action=ev.corrective_action,
        category_name=ev.category.category_name if ev.category else None,
        machine_name=ev.machine.machine_name if ev.machine else None,
        duration_minutes=kpi_svc.downtime_minutes(ev.started_at, ev.ended_at),
    )


def _naive_wall(dt: datetime) -> datetime:
    """Store comparable naive datetimes (MySQL DATETIME) using factory wall-clock time."""
    if dt.tzinfo is None:
        return dt.replace(microsecond=0)
    # Drop tzinfo but keep the displayed local clock (14:30+03 → 14:30), not UTC.
    return dt.replace(tzinfo=None, microsecond=0)


def _ensure_category(db: Session, group_name: str, planned: str = "unplanned") -> DowntimeCategory:
    existing = db.scalar(
        select(DowntimeCategory).where(DowntimeCategory.category_name == group_name)
    )
    if existing:
        return existing
    cat = DowntimeCategory(category_name=group_name, planned_or_unplanned=planned)
    db.add(cat)
    db.flush()
    return cat


@router.get("/catalog")
def stop_reason_catalog(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Hierarchical stop groups + reasons for operator coding UI."""
    payload = catalog_payload()
    # Ensure DB categories exist for each group so coding can FK them
    for g in payload["groups"]:
        _ensure_category(db, g["name"], g["planned_or_unplanned"])
    db.commit()
    cats = {
        c.category_name: c.id
        for c in db.scalars(select(DowntimeCategory)).all()
    }
    for g in payload["groups"]:
        g["category_id"] = cats.get(g["name"])
    return payload


@router.get("/categories")
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return list(db.scalars(select(DowntimeCategory).order_by(DowntimeCategory.category_name)).all())


class CodeStopPayload(BaseModel):
    machine_id: int
    started_at: datetime
    ended_at: datetime
    reason: str
    category_id: int | None = None
    group_name: str | None = None
    notes: str | None = None
    work_order_id: int | None = None


@router.post("/code-stop", response_model=DowntimeOut)
def code_stop(
    payload: CodeStopPayload,
    db: Session = Depends(get_db),
    user: User = Depends(
        require_roles(
            "Administrator",
            "Production Manager",
            "Production Supervisor",
            "Machine Operator",
            "Maintenance User",
        )
    ),
):
    """Assign a stop reason to an uncommented timeline window (operator workflow)."""
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(400, "Reason is required")

    # Normalize to naive wall-clock for MySQL DATETIME columns
    started_at = _naive_wall(payload.started_at)
    ended_at = _naive_wall(payload.ended_at)
    if ended_at <= started_at:
        raise HTTPException(400, "ended_at must be after started_at")

    category_id = payload.category_id
    if not category_id:
        group = find_group_for_reason(reason)
        group_name = payload.group_name or (group["name"] if group else "Organisational")
        planned = group["planned_or_unplanned"] if group else "unplanned"
        cat = _ensure_category(db, group_name, planned)
        category_id = cat.id

    # Upsert: if an overlapping open/coded event exists for this machine, update it
    existing = list(
        db.scalars(
            select(DowntimeEvent)
            .where(DowntimeEvent.machine_id == payload.machine_id)
            .where(DowntimeEvent.started_at <= ended_at)
            .where(
                (DowntimeEvent.ended_at == None)  # noqa: E711
                | (DowntimeEvent.ended_at >= started_at)
            )
            .order_by(DowntimeEvent.started_at.desc())
            .limit(5)
        ).all()
    )
    ev = None
    for cand in existing:
        # Prefer near-exact window match (±3 min)
        cand_start = _naive_wall(cand.started_at)
        cand_end = _naive_wall(cand.ended_at) if cand.ended_at else ended_at
        start_delta = abs((cand_start - started_at).total_seconds())
        end_delta = abs((cand_end - ended_at).total_seconds())
        if start_delta <= 180 and end_delta <= 180:
            ev = cand
            break

    if ev:
        ev.category_id = category_id
        ev.reason = reason
        ev.notes = payload.notes
        ev.started_at = started_at
        ev.ended_at = ended_at
        ev.status = "Coded"
        ev.verified_by = user.id
        action = "code"
    else:
        ev = DowntimeEvent(
            machine_id=payload.machine_id,
            work_order_id=payload.work_order_id,
            category_id=category_id,
            started_at=started_at,
            ended_at=ended_at,
            reason=reason,
            notes=payload.notes,
            reported_by=user.id,
            status="Coded",
        )
        db.add(ev)
        action = "create"

    db.flush()
    log_action(db, user_id=user.id, action=action, entity_type="downtime_event", entity_id=ev.id)
    db.commit()
    ev = db.scalar(
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category), joinedload(DowntimeEvent.machine))
        .where(DowntimeEvent.id == ev.id)
    )
    return _to_out(ev)


@router.get("/pareto")
def downtime_pareto(
    days: int = 7,
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Pareto of stop reasons over the last N days (for Reports)."""
    days = max(1, min(days, 90))
    since = datetime.now(timezone.utc) - timedelta(days=days)
    q = (
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category), joinedload(DowntimeEvent.machine))
        .where(DowntimeEvent.started_at >= since)
    )
    if machine_id:
        q = q.where(DowntimeEvent.machine_id == machine_id)
    events = list(db.scalars(q).unique().all())

    buckets: dict[str, dict] = {}
    planned_minutes = days * 24 * 60  # coarse plant-wide planned time for %
    for ev in events:
        reason = (ev.reason or "").strip() or (
            ev.category.category_name if ev.category else "Uncommented"
        )
        mins = kpi_svc.downtime_minutes(ev.started_at, ev.ended_at) or 0
        if reason not in buckets:
            group = find_group_for_reason(reason)
            buckets[reason] = {
                "reason": reason,
                "group": group["name"] if group else (ev.category.category_name if ev.category else "Uncommented"),
                "color": reason_color(reason),
                "minutes": 0.0,
                "count": 0,
                "notes_count": 0,
            }
        buckets[reason]["minutes"] += mins
        buckets[reason]["count"] += 1
        if ev.notes:
            buckets[reason]["notes_count"] += 1

    rows = sorted(buckets.values(), key=lambda r: r["minutes"], reverse=True)
    for r in rows:
        r["duration_label"] = _fmt_duration(r["minutes"])
        r["avg_minutes"] = round(r["minutes"] / r["count"], 1) if r["count"] else 0
        r["avg_duration_label"] = _fmt_duration(r["avg_minutes"])
        r["pct_of_planned"] = round((r["minutes"] / planned_minutes) * 100, 2) if planned_minutes else 0

    return {
        "days": days,
        "machine_id": machine_id,
        "total_minutes": round(sum(r["minutes"] for r in rows), 1),
        "rows": rows,
    }


def _fmt_duration(minutes: float) -> str:
    total = int(round(minutes))
    if total < 60:
        return f"{total}m"
    h, m = divmod(total, 60)
    if h < 24:
        return f"{h}h {m:02d}m"
    d, h = divmod(h, 24)
    return f"{d}d {h}h"


@router.get("", response_model=list[DowntimeOut])
def list_downtime(
    machine_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(DowntimeEvent).options(
        joinedload(DowntimeEvent.category),
        joinedload(DowntimeEvent.machine),
    )
    if machine_id:
        q = q.where(DowntimeEvent.machine_id == machine_id)
    if status:
        q = q.where(DowntimeEvent.status == status)
    return [_to_out(ev) for ev in db.scalars(q.order_by(DowntimeEvent.started_at.desc()).limit(200)).unique().all()]


@router.post("", response_model=DowntimeOut)
def create_downtime(
    payload: DowntimeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(
        require_roles(
            "Administrator",
            "Production Manager",
            "Production Supervisor",
            "Machine Operator",
            "Maintenance User",
        )
    ),
):
    ev = DowntimeEvent(**payload.model_dump(), reported_by=user.id)
    db.add(ev)
    machine = db.get(Machine, payload.machine_id)
    if machine and machine.status == "Running":
        machine.status = "Unplanned Stop"
        machine.last_update_at = datetime.now(timezone.utc)
        machine.status_source = "manual"
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="downtime_event", entity_id=ev.id)
    db.commit()
    ev = db.scalar(
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category), joinedload(DowntimeEvent.machine))
        .where(DowntimeEvent.id == ev.id)
    )
    return _to_out(ev)


@router.patch("/{event_id}", response_model=DowntimeOut)
def update_downtime(
    event_id: int,
    payload: DowntimeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(
        require_roles(
            "Administrator",
            "Production Manager",
            "Production Supervisor",
            "Maintenance User",
        )
    ),
):
    ev = db.get(DowntimeEvent, event_id)
    if not ev:
        raise HTTPException(404, "Downtime event not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(ev, k, v)
    ev.verified_by = user.id
    log_action(db, user_id=user.id, action="update", entity_type="downtime_event", entity_id=ev.id)
    db.commit()
    ev = db.scalar(
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category), joinedload(DowntimeEvent.machine))
        .where(DowntimeEvent.id == event_id)
    )
    return _to_out(ev)
