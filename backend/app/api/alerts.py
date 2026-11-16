from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles
from app.models.alert import Alert
from app.models.user import User
from app.schemas.common import AlertOut, AlertUpdate
from app.services.audit import log_action

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertOut])
def list_alerts(
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(Alert)
    if status:
        q = q.where(Alert.status == status)
    return list(db.scalars(q.order_by(Alert.created_at.desc()).limit(100)).all())


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert(
    alert_id: int,
    payload: AlertUpdate,
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
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(alert, k, v)
    if data.get("status") in ("Closed", "Resolved"):
        alert.resolved_at = datetime.now(timezone.utc)
    log_action(db, user_id=user.id, action="update", entity_type="alert", entity_id=alert.id)
    db.commit()
    db.refresh(alert)
    return alert
