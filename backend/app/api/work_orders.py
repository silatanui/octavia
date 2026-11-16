from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.user import User
from app.models.work_order import WorkOrder
from app.schemas.common import WorkOrderCreate, WorkOrderOut, WorkOrderUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/work-orders", tags=["work-orders"])


def _to_out(wo: WorkOrder) -> WorkOrderOut:
    return WorkOrderOut(
        id=wo.id,
        order_number=wo.order_number,
        product_id=wo.product_id,
        machine_id=wo.machine_id,
        planned_quantity=wo.planned_quantity,
        actual_quantity=wo.actual_quantity,
        good_quantity=wo.good_quantity,
        rejected_quantity=wo.rejected_quantity,
        planned_start=wo.planned_start,
        planned_end=wo.planned_end,
        actual_start=wo.actual_start,
        actual_end=wo.actual_end,
        customer_ref=wo.customer_ref,
        status=wo.status,
        notes=wo.notes,
        product_name=wo.product.product_name if wo.product else None,
        machine_name=wo.machine.machine_name if wo.machine else None,
    )


@router.get("", response_model=list[WorkOrderOut])
def list_work_orders(
    status: str | None = None,
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(WorkOrder).options(joinedload(WorkOrder.product), joinedload(WorkOrder.machine))
    if status:
        q = q.where(WorkOrder.status == status)
    if machine_id:
        q = q.where(WorkOrder.machine_id == machine_id)
    return [_to_out(wo) for wo in db.scalars(q.order_by(WorkOrder.id.desc())).unique().all()]


@router.post("", response_model=WorkOrderOut)
def create_work_order(
    payload: WorkOrderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator", "Production Manager", "Production Supervisor")),
):
    wo = WorkOrder(**payload.model_dump())
    db.add(wo)
    db.flush()
    log_action(db, user_id=user.id, action="create", entity_type="work_order", entity_id=wo.id)
    db.commit()
    wo = db.scalar(
        select(WorkOrder)
        .options(joinedload(WorkOrder.product), joinedload(WorkOrder.machine))
        .where(WorkOrder.id == wo.id)
    )
    return _to_out(wo)


@router.get("/{wo_id}", response_model=WorkOrderOut)
def get_work_order(wo_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    wo = db.scalar(
        select(WorkOrder)
        .options(joinedload(WorkOrder.product), joinedload(WorkOrder.machine))
        .where(WorkOrder.id == wo_id)
    )
    if not wo:
        raise HTTPException(404, "Work order not found")
    return _to_out(wo)


@router.patch("/{wo_id}", response_model=WorkOrderOut)
def update_work_order(
    wo_id: int,
    payload: WorkOrderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("Administrator", "Production Manager", "Production Supervisor")),
):
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(wo, k, v)
    log_action(db, user_id=user.id, action="update", entity_type="work_order", entity_id=wo.id)
    db.commit()
    wo = db.scalar(
        select(WorkOrder)
        .options(joinedload(WorkOrder.product), joinedload(WorkOrder.machine))
        .where(WorkOrder.id == wo_id)
    )
    return _to_out(wo)
