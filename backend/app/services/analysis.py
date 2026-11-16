"""Plant analysis aggregates for OEE / downtime / quantity widgets."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.downtime import DowntimeEvent
from app.models.machine import Machine
from app.models.production import ProductionRecord
from app.services import kpi as kpi_svc
from app.services.shift_structure import (
    ANALYSIS_SHIFT_HOURS,
    ANALYSIS_SHIFTS_PER_DAY,
    average_planned_loss_minutes_per_shift,
    plant_net_planned_minutes,
)
from app.services.stop_catalog import find_group_for_reason, reason_color


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window(days: int, end: datetime | None = None) -> tuple[datetime, datetime]:
    end = end or _utc_now()
    start = end - timedelta(days=days)
    return start, end


def _fmt_duration(minutes: float) -> str:
    total = int(round(minutes))
    if total < 60:
        return f"{total}m"
    h, m = divmod(total, 60)
    if h < 24:
        return f"{h}h {m:02d}m"
    d, h = divmod(h, 24)
    return f"{d}d {h}h"


def _period_production(db: Session, start: datetime, end: datetime) -> dict[str, float]:
    rows = list(
        db.scalars(
            select(ProductionRecord).where(
                ProductionRecord.recorded_at >= start,
                ProductionRecord.recorded_at < end,
            )
        ).all()
    )
    total = sum(r.total_units or 0 for r in rows)
    good = sum(r.good_units or 0 for r in rows)
    rejected = sum(r.rejected_units or 0 for r in rows)
    return {"total": float(total), "good": float(good), "rejected": float(rejected), "count": float(len(rows))}


def _period_downtime_minutes(db: Session, start: datetime, end: datetime) -> float:
    events = list(
        db.scalars(
            select(DowntimeEvent).where(
                DowntimeEvent.started_at >= start,
                DowntimeEvent.started_at < end,
            )
        ).all()
    )
    return float(sum(kpi_svc.downtime_minutes(ev.started_at, ev.ended_at) or 0 for ev in events))


def _active_machine_count(db: Session) -> int:
    n = len(list(db.scalars(select(Machine).where(Machine.active.is_(True))).all()))
    return max(n, 1)


def _oee_block(db: Session, days: int, end: datetime | None = None) -> dict[str, Any]:
    start, end = _window(days, end)
    prev_end = start
    prev_start = prev_end - timedelta(days=days)

    prod = _period_production(db, start, end)
    prev = _period_production(db, prev_start, prev_end)
    dt_mins = _period_downtime_minutes(db, start, end)
    prev_dt = _period_downtime_minutes(db, prev_start, prev_end)

    machines = _active_machine_count(db)
    # Net planned time: shift length minus typical startup (~10m), break (10–30m), wind-down (~12m)
    planned_mins = plant_net_planned_minutes(days=days, machines=machines)
    # Coarse: treat recorded downtime as mostly unplanned against net planned time
    structure_loss = average_planned_loss_minutes_per_shift()
    # Strip an estimate of structured losses that may sit inside downtime records (breaks coded as Break)
    unplanned_mins = max(dt_mins - (structure_loss * ANALYSIS_SHIFTS_PER_DAY * days * 0.35), 0)
    operating_mins = max(planned_mins - unplanned_mins, 0)

    availability = kpi_svc.availability(operating_mins * 60, planned_mins * 60)
    quality = kpi_svc.quality(prod["good"], prod["total"]) if prod["total"] else 98.5
    # Theoretical pcs only during net planned minutes
    theoretical = machines * planned_mins * 0.55
    performance = kpi_svc.pct(prod["good"], theoretical) if theoretical else None
    if performance is not None:
        performance = min(performance, 100.0)
    else:
        performance = 90.0
    if availability is None:
        availability = 80.0
    if quality is None:
        quality = 98.0

    oee = kpi_svc.oee(availability, performance, quality) or 0.0

    prev_planned = plant_net_planned_minutes(days=days, machines=machines)
    prev_unplanned = max(prev_dt - (structure_loss * ANALYSIS_SHIFTS_PER_DAY * days * 0.35), 0)
    prev_operating = max(prev_planned - prev_unplanned, 0)
    prev_a = kpi_svc.availability(prev_operating * 60, prev_planned * 60) or availability
    prev_q = kpi_svc.quality(prev["good"], prev["total"]) if prev["total"] else quality
    prev_theo = theoretical
    prev_p = kpi_svc.pct(prev["good"], prev_theo) if prev_theo else performance
    if prev_p is not None:
        prev_p = min(prev_p, 100.0)
    else:
        prev_p = performance
    prev_oee = kpi_svc.oee(prev_a, prev_p, prev_q) or oee
    delta = round(oee - prev_oee, 2)

    return {
        "days": days,
        "oee": round(oee, 2),
        "delta": delta,
        "availability": round(availability, 2),
        "performance": round(performance, 2),
        "quality": round(quality, 2),
        "total_units": int(prod["total"]),
        "good_units": int(prod["good"]),
        "rejected_units": int(prod["rejected"]),
        "downtime_minutes": round(dt_mins, 1),
        "planned_minutes_net": round(planned_mins, 1),
        "structure_loss_minutes_per_shift": round(structure_loss, 1),
        "shift_hours_gross": ANALYSIS_SHIFT_HOURS,
        "shifts_per_day": ANALYSIS_SHIFTS_PER_DAY,
    }


def _downtime_pareto(db: Session, days: int) -> dict[str, Any]:
    start, end = _window(days)
    events = list(
        db.scalars(
            select(DowntimeEvent)
            .options(joinedload(DowntimeEvent.category))
            .where(DowntimeEvent.started_at >= start, DowntimeEvent.started_at < end)
        )
        .unique()
        .all()
    )
    buckets: dict[str, dict[str, Any]] = {}
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
            }
        buckets[reason]["minutes"] += mins
        buckets[reason]["count"] += 1

    rows = sorted(buckets.values(), key=lambda r: r["minutes"], reverse=True)[:10]
    for r in rows:
        r["hours"] = round(r["minutes"] / 60, 2)
        r["duration_label"] = _fmt_duration(r["minutes"])
    return {
        "days": days,
        "total_minutes": round(sum(r["minutes"] for r in rows), 1),
        "rows": rows,
    }


def _daily_quantity(db: Session, days: int = 30) -> list[dict[str, Any]]:
    start, end = _window(days)
    rows = list(
        db.scalars(
            select(ProductionRecord).where(
                ProductionRecord.recorded_at >= start,
                ProductionRecord.recorded_at < end,
            )
        ).all()
    )
    by_day: dict[date, dict[str, float]] = defaultdict(lambda: {"total": 0.0, "good": 0.0, "rejected": 0.0})
    for r in rows:
        d = r.recorded_at.date() if hasattr(r.recorded_at, "date") else start.date()
        by_day[d]["total"] += r.total_units or 0
        by_day[d]["good"] += r.good_units or 0
        by_day[d]["rejected"] += r.rejected_units or 0

    out: list[dict[str, Any]] = []
    cursor = (end - timedelta(days=days - 1)).date()
    last = end.date()
    while cursor <= last:
        bucket = by_day.get(cursor, {"total": 0.0, "good": 0.0, "rejected": 0.0})
        out.append(
            {
                "date": cursor.isoformat(),
                "label": cursor.strftime("%d %b"),
                "total": int(round(bucket["total"])),
                "good": int(round(bucket["good"])),
                "scrap": int(round(bucket["rejected"])),
            }
        )
        cursor += timedelta(days=1)
    return out


def build_analysis_overview(db: Session) -> dict[str, Any]:
    return {
        "generated_at": _utc_now().isoformat(),
        "oee_7d": _oee_block(db, 7),
        "oee_30d": _oee_block(db, 30),
        "downtime_7d": _downtime_pareto(db, 7),
        "downtime_30d": _downtime_pareto(db, 30),
        "quantity_30d": _daily_quantity(db, 30),
    }
