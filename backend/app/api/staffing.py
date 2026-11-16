from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import ROLE_HIERARCHY, get_current_user, require_min_role
from app.models.machine import Machine
from app.models.org import Department, ProductionLine
from app.models.shift import Shift
from app.models.staff import ASSIGNMENT_ROLES, LEAD_ROLES, MACHINE_ROLES, StaffAssignment
from app.models.user import User
from app.schemas.staffing import (
    StaffAssignmentCreate,
    StaffAssignmentOut,
    StaffAssignmentUpdate,
    StaffingAvailableUser,
    StaffingBoard,
    StaffingLineBlock,
    StaffingMachineSlot,
    StaffingOptions,
)
from app.services.audit import log_action

router = APIRouter(prefix="/staffing", tags=["staffing"])

EDIT_MIN_ROLE = "Production Supervisor"

ROLE_LABELS = {
    "section_lead": "Section lead",
    "team_lead": "Team lead",
    "operator": "Operator",
    "junior": "Junior",
    "relief": "Relief",
}


def _can_edit(user: User) -> bool:
    role_name = user.role.role_name if user.role else ""
    return ROLE_HIERARCHY.get(role_name, 0) >= ROLE_HIERARCHY.get(EDIT_MIN_ROLE, 999)


def _serialize(row: StaffAssignment) -> StaffAssignmentOut:
    user = row.user
    machine = row.machine
    line = row.production_line
    if machine is not None and line is None:
        line = machine.production_line
    return StaffAssignmentOut(
        id=row.id,
        user_id=row.user_id,
        user_name=user.name if user else "—",
        user_email=user.email if user else None,
        user_role_name=user.role.role_name if user and user.role else None,
        work_date=row.work_date,
        shift_id=row.shift_id,
        shift_name=row.shift.shift_name if row.shift else None,
        assignment_role=row.assignment_role,
        production_line_id=row.production_line_id or (line.id if line else None),
        line_name=line.line_name if line else None,
        machine_id=row.machine_id,
        machine_code=machine.machine_code if machine else None,
        machine_name=machine.machine_name if machine else None,
        notes=row.notes,
        created_by=row.created_by,
        created_at=row.created_at,
    )


def _validate_placement(
    *,
    role: str,
    production_line_id: int | None,
    machine_id: int | None,
    db: Session,
) -> tuple[int | None, int | None]:
    if role not in ASSIGNMENT_ROLES:
        raise HTTPException(400, f"Unknown assignment_role. Use one of: {', '.join(sorted(ASSIGNMENT_ROLES))}")

    if role in LEAD_ROLES:
        if not production_line_id:
            raise HTTPException(400, "Section/team leads must be placed on a production line")
        if machine_id:
            raise HTTPException(400, "Leads are placed on a line, not a machine")
        line = db.get(ProductionLine, production_line_id)
        if not line:
            raise HTTPException(404, "Production line not found")
        return production_line_id, None

    # machine roles
    if not machine_id:
        raise HTTPException(400, "Operators, juniors, and relief must be placed on a machine")
    machine = db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    if production_line_id and production_line_id != machine.production_line_id:
        raise HTTPException(400, "Machine does not belong to the selected production line")
    return machine.production_line_id, machine_id


def _load_assignment(db: Session, assignment_id: int) -> StaffAssignment:
    row = db.scalars(
        select(StaffAssignment)
        .where(StaffAssignment.id == assignment_id)
        .options(
            joinedload(StaffAssignment.user).joinedload(User.role),
            joinedload(StaffAssignment.shift),
            joinedload(StaffAssignment.production_line),
            joinedload(StaffAssignment.machine).joinedload(Machine.production_line),
        )
    ).unique().first()
    if not row:
        raise HTTPException(404, "Assignment not found")
    return row


@router.get("/options", response_model=StaffingOptions)
def staffing_options(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    users = list(
        db.scalars(
            select(User)
            .where(User.status == "active")
            .options(joinedload(User.role))
            .order_by(User.name.asc())
        )
        .unique()
        .all()
    )
    shifts = list(db.scalars(select(Shift).order_by(Shift.id.asc())).all())
    departments = list(db.scalars(select(Department).order_by(Department.department_name.asc())).all())
    lines = list(
        db.scalars(
            select(ProductionLine)
            .options(joinedload(ProductionLine.department))
            .order_by(ProductionLine.line_name.asc())
        )
        .unique()
        .all()
    )
    machines = list(
        db.scalars(
            select(Machine)
            .options(joinedload(Machine.production_line))
            .order_by(Machine.machine_code.asc())
        )
        .unique()
        .all()
    )
    return StaffingOptions(
        users=[
            StaffingAvailableUser(
                id=u.id,
                name=u.name,
                email=u.email,
                role_name=u.role.role_name if u.role else None,
            )
            for u in users
        ],
        shifts=[
            {
                "id": s.id,
                "shift_name": s.shift_name,
                "site_id": s.site_id,
                "start_time": s.start_time.isoformat() if s.start_time else None,
                "end_time": s.end_time.isoformat() if s.end_time else None,
            }
            for s in shifts
        ],
        departments=[{"id": d.id, "department_name": d.department_name, "site_id": d.site_id} for d in departments],
        lines=[
            {
                "id": ln.id,
                "line_name": ln.line_name,
                "department_id": ln.department_id,
                "department_name": ln.department.department_name if ln.department else None,
            }
            for ln in lines
        ],
        machines=[
            {
                "id": m.id,
                "machine_code": m.machine_code,
                "machine_name": m.machine_name,
                "status": m.status,
                "production_line_id": m.production_line_id,
            }
            for m in machines
        ],
        roles=[{"key": k, "label": ROLE_LABELS[k]} for k in ("section_lead", "team_lead", "operator", "junior", "relief")],
    )


@router.get("", response_model=StaffingBoard)
def staffing_board(
    work_date: date = Query(...),
    shift_id: int | None = None,
    department_id: int | None = None,
    line_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    shift = None
    if shift_id:
        shift = db.get(Shift, shift_id)
        if not shift:
            raise HTTPException(404, "Shift not found")
    else:
        # Default to first shift for the site when not specified
        shift = db.scalars(select(Shift).order_by(Shift.id.asc())).first()
        shift_id = shift.id if shift else None

    lines_q = select(ProductionLine).options(
        joinedload(ProductionLine.department),
        joinedload(ProductionLine.machines),
    )
    if department_id:
        lines_q = lines_q.where(ProductionLine.department_id == department_id)
    if line_id:
        lines_q = lines_q.where(ProductionLine.id == line_id)
    lines = list(db.scalars(lines_q.order_by(ProductionLine.line_name.asc())).unique().all())

    assignments: list[StaffAssignment] = []
    if shift_id:
        assignments = list(
            db.scalars(
                select(StaffAssignment)
                .where(
                    StaffAssignment.work_date == work_date,
                    StaffAssignment.shift_id == shift_id,
                )
                .options(
                    joinedload(StaffAssignment.user).joinedload(User.role),
                    joinedload(StaffAssignment.shift),
                    joinedload(StaffAssignment.production_line),
                    joinedload(StaffAssignment.machine).joinedload(Machine.production_line),
                )
            )
            .unique()
            .all()
        )

    assigned_user_ids = {a.user_id for a in assignments}
    all_users = list(
        db.scalars(
            select(User)
            .where(User.status == "active")
            .options(joinedload(User.role))
            .order_by(User.name.asc())
        )
        .unique()
        .all()
    )
    available = [
        StaffingAvailableUser(
            id=u.id,
            name=u.name,
            email=u.email,
            role_name=u.role.role_name if u.role else None,
        )
        for u in all_users
        if u.id not in assigned_user_ids
    ]

    by_line_leads: dict[int, list[StaffAssignmentOut]] = {ln.id: [] for ln in lines}
    by_machine: dict[int, list[StaffAssignmentOut]] = {}
    for ln in lines:
        for m in ln.machines or []:
            by_machine[m.id] = []

    unplaced: list[StaffAssignmentOut] = []
    line_ids = {ln.id for ln in lines}

    for row in assignments:
        out = _serialize(row)
        if row.assignment_role in LEAD_ROLES and row.production_line_id in by_line_leads:
            by_line_leads[row.production_line_id].append(out)
            continue
        if row.machine_id and row.machine_id in by_machine:
            # respect department/line filters
            mid_line = row.machine.production_line_id if row.machine else None
            if mid_line in line_ids:
                by_machine[row.machine_id].append(out)
                continue
        # Filtered out or incomplete placement
        if not department_id and not line_id:
            unplaced.append(out)

    line_blocks: list[StaffingLineBlock] = []
    for ln in lines:
        machines = sorted(ln.machines or [], key=lambda m: m.machine_code)
        line_blocks.append(
            StaffingLineBlock(
                production_line_id=ln.id,
                line_name=ln.line_name,
                department_id=ln.department_id,
                department_name=ln.department.department_name if ln.department else "—",
                leads=by_line_leads.get(ln.id, []),
                machines=[
                    StaffingMachineSlot(
                        machine_id=m.id,
                        machine_code=m.machine_code,
                        machine_name=m.machine_name,
                        status=m.status,
                        staff=by_machine.get(m.id, []),
                    )
                    for m in machines
                ],
            )
        )

    return StaffingBoard(
        work_date=work_date,
        shift_id=shift_id,
        shift_name=shift.shift_name if shift else None,
        can_edit=_can_edit(user),
        available=available,
        lines=line_blocks,
        unplaced=unplaced,
    )


@router.post("", response_model=StaffAssignmentOut)
def create_assignment(
    payload: StaffAssignmentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_min_role(EDIT_MIN_ROLE)),
):
    target = db.get(User, payload.user_id)
    if not target or target.status != "active":
        raise HTTPException(404, "User not found or inactive")
    if not db.get(Shift, payload.shift_id):
        raise HTTPException(404, "Shift not found")

    line_id, machine_id = _validate_placement(
        role=payload.assignment_role,
        production_line_id=payload.production_line_id,
        machine_id=payload.machine_id,
        db=db,
    )

    existing = db.scalars(
        select(StaffAssignment).where(
            StaffAssignment.user_id == payload.user_id,
            StaffAssignment.work_date == payload.work_date,
            StaffAssignment.shift_id == payload.shift_id,
        )
    ).first()
    if existing:
        raise HTTPException(400, "This person is already assigned for that date and shift")

    row = StaffAssignment(
        user_id=payload.user_id,
        work_date=payload.work_date,
        shift_id=payload.shift_id,
        assignment_role=payload.assignment_role,
        production_line_id=line_id if payload.assignment_role in LEAD_ROLES else None,
        machine_id=machine_id,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "This person is already assigned for that date and shift") from None

    log_action(db, user_id=user.id, action="create", entity_type="staff_assignment", entity_id=row.id)
    db.commit()
    return _serialize(_load_assignment(db, row.id))


@router.patch("/{assignment_id}", response_model=StaffAssignmentOut)
def update_assignment(
    assignment_id: int,
    payload: StaffAssignmentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_min_role(EDIT_MIN_ROLE)),
):
    row = _load_assignment(db, assignment_id)
    role = payload.assignment_role or row.assignment_role

    line_id = row.production_line_id
    machine_id = row.machine_id
    if payload.clear_line:
        line_id = None
    if payload.clear_machine:
        machine_id = None
    if payload.production_line_id is not None:
        line_id = payload.production_line_id
    if payload.machine_id is not None:
        machine_id = payload.machine_id

    line_id, machine_id = _validate_placement(
        role=role,
        production_line_id=line_id,
        machine_id=machine_id,
        db=db,
    )

    row.assignment_role = role
    row.production_line_id = line_id if role in LEAD_ROLES else None
    row.machine_id = machine_id if role in MACHINE_ROLES else None
    if payload.notes is not None:
        row.notes = payload.notes

    log_action(db, user_id=user.id, action="update", entity_type="staff_assignment", entity_id=row.id)
    db.commit()
    return _serialize(_load_assignment(db, row.id))


@router.delete("/{assignment_id}")
def delete_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_min_role(EDIT_MIN_ROLE)),
):
    row = db.get(StaffAssignment, assignment_id)
    if not row:
        raise HTTPException(404, "Assignment not found")
    db.delete(row)
    log_action(db, user_id=user.id, action="delete", entity_type="staff_assignment", entity_id=assignment_id)
    db.commit()
    return {"ok": True}
