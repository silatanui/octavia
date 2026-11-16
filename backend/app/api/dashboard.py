import csv
import io
from datetime import date as date_cls

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.dashboard import build_dashboard
from app.services.summary import build_ai_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/daily")
def daily_dashboard(
    date: str = Query(default_factory=lambda: date_cls.today().isoformat()),
    site_id: int | None = None,
    department_id: int | None = None,
    line_id: int | None = None,
    shift_id: int | None = None,
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return build_dashboard(
        db,
        date=date,
        site_id=site_id,
        department_id=department_id,
        line_id=line_id,
        shift_id=shift_id,
        machine_id=machine_id,
    )


@router.get("/ai-summary")
def ai_summary(
    date: str = Query(default_factory=lambda: date_cls.today().isoformat()),
    site_id: int | None = None,
    department_id: int | None = None,
    line_id: int | None = None,
    shift_id: int | None = None,
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = build_dashboard(
        db,
        date=date,
        site_id=site_id,
        department_id=department_id,
        line_id=line_id,
        shift_id=shift_id,
        machine_id=machine_id,
    )
    return build_ai_summary(data)


@router.get("/export.csv")
def export_csv(
    date: str = Query(default_factory=lambda: date_cls.today().isoformat()),
    site_id: int | None = None,
    department_id: int | None = None,
    line_id: int | None = None,
    shift_id: int | None = None,
    machine_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = build_dashboard(
        db,
        date=date,
        site_id=site_id,
        department_id=department_id,
        line_id=line_id,
        shift_id=shift_id,
        machine_id=machine_id,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "machine_code",
            "machine_name",
            "line",
            "status",
            "output",
            "target",
            "achievement",
            "availability",
            "oee",
            "downtime_minutes",
        ]
    )
    for m in data["machines"]:
        writer.writerow(
            [
                m["machine_code"],
                m["machine_name"],
                m["line_name"],
                m["status"],
                m["output"],
                m["target"],
                m["achievement"],
                m["availability"],
                m["oee"],
                m["downtime_minutes"],
            ]
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="octavia_daily_{date}.csv"'},
    )
