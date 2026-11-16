import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services.openai_assist import analyze_management_report, chat_with_context, openai_configured
from app.services.reports import build_management_report

router = APIRouter(prefix="/reports", tags=["reports"])


class ChatTurn(BaseModel):
    role: str
    content: str


class ReportChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list)
    days: int = Field(default=30, ge=1, le=90)
    department_id: int | None = None
    line_id: int | None = None
    machine_id: int | None = None
    shift_id: int | None = None


def _report_filters(
    db: Session,
    *,
    days: int,
    department_id: int | None,
    line_id: int | None,
    machine_id: int | None,
    shift_id: int | None,
):
    return build_management_report(
        db,
        days=days,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
        shift_id=shift_id,
    )


@router.get("/management")
def management_report(
    days: int = Query(30, ge=1, le=90),
    department_id: int | None = None,
    line_id: int | None = None,
    machine_id: int | None = None,
    shift_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return build_management_report(
        db,
        days=days,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
        shift_id=shift_id,
    )


@router.get("/management.csv")
def management_report_csv(
    days: int = Query(30, ge=1, le=90),
    department_id: int | None = None,
    line_id: int | None = None,
    machine_id: int | None = None,
    shift_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = build_management_report(
        db,
        days=days,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
        shift_id=shift_id,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "scope",
            "days",
            "machine_code",
            "machine_name",
            "line",
            "oee",
            "availability",
            "performance",
            "quality",
            "output",
            "good",
            "scrap",
            "downtime_minutes",
        ]
    )
    for m in data["machine_compare"]:
        writer.writerow(
            [
                data["scope_label"],
                days,
                m["machine_code"],
                m["machine_name"],
                m.get("line_name") or "",
                m.get("oee"),
                m.get("availability"),
                m.get("performance"),
                m.get("quality"),
                m.get("output"),
                m.get("good"),
                m.get("scrap"),
                m.get("downtime_minutes"),
            ]
        )
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="octavia_management_{days}d.csv"'},
    )


@router.get("/ai-status")
def ai_status(_: User = Depends(get_current_user)):
    return {"openai_configured": openai_configured()}


@router.get("/ai-analysis")
def ai_analysis(
    days: int = Query(30, ge=1, le=90),
    department_id: int | None = None,
    line_id: int | None = None,
    machine_id: int | None = None,
    shift_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    report = _report_filters(
        db,
        days=days,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
        shift_id=shift_id,
    )
    return analyze_management_report(report)


@router.post("/ai-chat")
def ai_chat(
    payload: ReportChatIn,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    report = _report_filters(
        db,
        days=payload.days,
        department_id=payload.department_id,
        line_id=payload.line_id,
        machine_id=payload.machine_id,
        shift_id=payload.shift_id,
    )
    return chat_with_context(
        message=payload.message,
        history=[t.model_dump() for t in payload.history],
        report=report,
    )
