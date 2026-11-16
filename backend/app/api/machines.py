from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.machine import Machine
from app.models.user import User
from app.schemas.common import MachineCreate, MachineOut, MachineUpdate
from app.services import kpi as kpi_svc
from app.services.audit import log_action
from app.services.station import build_station_board

router = APIRouter(prefix="/machines", tags=["machines"])


def _to_out(m: Machine) -> MachineOut:
    return MachineOut(
        id=m.id,
        production_line_id=m.production_line_id,
        machine_code=m.machine_code,
        machine_name=m.machine_name,
        machine_type=m.machine_type,
        status=m.status,
        active=m.active,
        last_update_at=m.last_update_at,
        status_source=m.status_source,
        line_name=m.production_line.line_name if m.production_line else None,
    )


@router.get("", response_model=list[MachineOut])
def list_machines(
    line_id: int | None = None,
    active: bool | None = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Machine).options(joinedload(Machine.production_line))
    if line_id:
        q = q.where(Machine.production_line_id == line_id)
    if active is not None:
        q = q.where(Machine.active.is_(active))
    return [_to_out(m) for m in db.scalars(q).unique().all()]


@router.post("", response_model=MachineOut)
def create_machine(
    payload: MachineCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator", "Production Manager")),
):
    machine = Machine(**payload.model_dump(), status_source="manual", last_update_at=datetime.now(timezone.utc))
    db.add(machine)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="machine", entity_id=machine.id)
    db.commit()
    db.refresh(machine)
    machine = db.scalar(select(Machine).options(joinedload(Machine.production_line)).where(Machine.id == machine.id))
    return _to_out(machine)


@router.get("/{machine_id}/station")
def machine_station(
    machine_id: int,
    date: str | None = None,
    shift: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    board = build_station_board(db, machine_id, date=date, shift=shift)
    if not board:
        raise HTTPException(404, "Machine not found")
    return board


@router.get("/{machine_id}")
def get_machine(
    machine_id: int,
    date: str | None = None,
    shift: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    board = build_station_board(db, machine_id, date=date, shift=shift)
    if not board:
        raise HTTPException(404, "Machine not found")
    # Keep legacy keys for any older callers, plus full station board
    m = board["machine"]
    return {
        **board,
        "machine": {
            **m,
            "production_line_id": None,
            "machine_type": None,
            "active": True,
        },
        "current_job": board.get("current_batch"),
        "kpis": {
            **board["kpis"],
            "planned": board["quantity"]["planned"],
            "actual": board["quantity"]["actual"],
            "achievement": kpi_svc.achievement(board["quantity"]["actual"], board["quantity"]["planned"]),
            "good_units": None,
            "rejected_units": None,
        },
    }


@router.patch("/{machine_id}", response_model=MachineOut)
def update_machine(
    machine_id: int,
    payload: MachineUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator", "Production Manager", "Production Supervisor")),
):
    machine = db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(machine, k, v)
    machine.last_update_at = datetime.now(timezone.utc)
    log_action(db, user_id=user.id, action="update", entity_type="machine", entity_id=machine.id)
    db.commit()
    machine = db.scalar(select(Machine).options(joinedload(Machine.production_line)).where(Machine.id == machine_id))
    return _to_out(machine)
