"""Filterable management report aggregates."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.downtime import DowntimeEvent
from app.models.machine import Machine
from app.models.org import Department, ProductionLine
from app.models.production import ProductionRecord
from app.models.shift import Shift
from app.services import kpi as kpi_svc
from app.services.shift_structure import (
    ANALYSIS_SHIFTS_PER_DAY,
    average_planned_loss_minutes_per_shift,
    net_planned_minutes_per_shift,
)
from app.services.stop_catalog import find_group_for_reason, reason_color


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window(days: int) -> tuple[datetime, datetime]:
    end = _utc_now()
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


def _scope_machines(
    db: Session,
    *,
    department_id: int | None,
    line_id: int | None,
    machine_id: int | None,
) -> list[Machine]:
    q = select(Machine).options(joinedload(Machine.production_line).joinedload(ProductionLine.department))
    q = q.where(Machine.active.is_(True))
    if machine_id:
        q = q.where(Machine.id == machine_id)
    elif line_id:
        q = q.where(Machine.production_line_id == line_id)
    elif department_id:
        q = q.join(ProductionLine).where(ProductionLine.department_id == department_id)
    return list(db.scalars(q).unique().all())


def _scope_label(
    db: Session,
    machines: list[Machine],
    *,
    department_id: int | None,
    line_id: int | None,
    machine_id: int | None,
) -> str:
    if machine_id and machines:
        m = machines[0]
        line = m.production_line.line_name if m.production_line else "—"
        return f"{m.machine_code} · {m.machine_name} · {line}"
    if line_id:
        ln = db.get(ProductionLine, line_id)
        return ln.line_name if ln else f"Line #{line_id}"
    if department_id:
        d = db.get(Department, department_id)
        return d.department_name if d else f"Department #{department_id}"
    return f"Plant · {len(machines)} machines"


def _prod_rows(
    db: Session,
    start: datetime,
    end: datetime,
    machine_ids: list[int],
    shift_id: int | None,
) -> list[ProductionRecord]:
    if not machine_ids:
        return []
    q = select(ProductionRecord).where(
        ProductionRecord.recorded_at >= start,
        ProductionRecord.recorded_at < end,
        ProductionRecord.machine_id.in_(machine_ids),
    )
    if shift_id:
        q = q.where(ProductionRecord.shift_id == shift_id)
    return list(db.scalars(q).all())


def _dt_events(
    db: Session,
    start: datetime,
    end: datetime,
    machine_ids: list[int],
) -> list[DowntimeEvent]:
    if not machine_ids:
        return []
    q = (
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category), joinedload(DowntimeEvent.machine))
        .where(
            DowntimeEvent.started_at >= start,
            DowntimeEvent.started_at < end,
            DowntimeEvent.machine_id.in_(machine_ids),
        )
    )
    return list(db.scalars(q).unique().all())


def _sum_prod(rows: list[ProductionRecord]) -> dict[str, float]:
    total = sum(r.total_units or 0 for r in rows)
    good = sum(r.good_units or 0 for r in rows)
    rejected = sum(r.rejected_units or 0 for r in rows)
    return {"total": float(total), "good": float(good), "rejected": float(rejected)}


def _sum_dt(events: list[DowntimeEvent]) -> float:
    return float(sum(kpi_svc.downtime_minutes(ev.started_at, ev.ended_at) or 0 for ev in events))


def _oee_from(
    *,
    days: int,
    machine_count: int,
    prod: dict[str, float],
    dt_mins: float,
) -> dict[str, float | None]:
    n = max(machine_count, 1)
    planned_mins = net_planned_minutes_per_shift() * ANALYSIS_SHIFTS_PER_DAY * days * n
    structure = average_planned_loss_minutes_per_shift()
    unplanned = max(dt_mins - (structure * ANALYSIS_SHIFTS_PER_DAY * days * n * 0.15), 0)
    operating = max(planned_mins - unplanned, 0)
    availability = kpi_svc.availability(operating * 60, planned_mins * 60)
    quality = kpi_svc.quality(prod["good"], prod["total"]) if prod["total"] else None
    # planned_mins already includes machine_count — do not multiply by n again
    theoretical = planned_mins * 0.55
    performance = kpi_svc.pct(prod["good"], theoretical) if theoretical else None
    if performance is not None:
        performance = min(performance, 100.0)
    oee = kpi_svc.oee(availability, performance, quality)
    achievement = kpi_svc.achievement(prod["good"], theoretical) if theoretical else None
    if achievement is not None:
        achievement = min(achievement, 120.0)
    return {
        "oee": oee,
        "availability": availability,
        "performance": performance,
        "quality": quality,
        "achievement": achievement,
        "planned_minutes": planned_mins,
        "operating_minutes": operating,
        "downtime_minutes": dt_mins,
    }


def _daily_series(
    days: int,
    end: datetime,
    prod_rows: list[ProductionRecord],
    dt_events: list[DowntimeEvent],
    machine_count: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    start_day = (end - timedelta(days=days - 1)).date()
    last = end.date()

    prod_by: dict[date, dict[str, float]] = defaultdict(lambda: {"total": 0.0, "good": 0.0, "rejected": 0.0})
    for r in prod_rows:
        d = r.recorded_at.date() if hasattr(r.recorded_at, "date") else start_day
        prod_by[d]["total"] += r.total_units or 0
        prod_by[d]["good"] += r.good_units or 0
        prod_by[d]["rejected"] += r.rejected_units or 0

    dt_by: dict[date, float] = defaultdict(float)
    for ev in dt_events:
        d = ev.started_at.date() if hasattr(ev.started_at, "date") else start_day
        dt_by[d] += kpi_svc.downtime_minutes(ev.started_at, ev.ended_at) or 0

    oee_trend: list[dict[str, Any]] = []
    output_trend: list[dict[str, Any]] = []
    downtime_by_day: list[dict[str, Any]] = []
    cursor = start_day
    while cursor <= last:
        p = prod_by.get(cursor, {"total": 0.0, "good": 0.0, "rejected": 0.0})
        dt = dt_by.get(cursor, 0.0)
        metrics = _oee_from(days=1, machine_count=machine_count, prod=p, dt_mins=dt)
        label = cursor.strftime("%d %b")
        oee_trend.append(
            {
                "date": cursor.isoformat(),
                "label": label,
                "oee": metrics["oee"],
                "availability": metrics["availability"],
                "performance": metrics["performance"],
                "quality": metrics["quality"],
            }
        )
        output_trend.append(
            {
                "date": cursor.isoformat(),
                "label": label,
                "total": int(round(p["total"])),
                "good": int(round(p["good"])),
                "scrap": int(round(p["rejected"])),
            }
        )
        downtime_by_day.append(
            {
                "date": cursor.isoformat(),
                "label": label,
                "minutes": round(dt, 1),
                "hours": round(dt / 60, 2),
            }
        )
        cursor += timedelta(days=1)
    return oee_trend, output_trend, downtime_by_day


def _pareto(events: list[DowntimeEvent], planned_minutes: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
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

    rows = sorted(buckets.values(), key=lambda r: r["minutes"], reverse=True)
    total_dt = sum(r["minutes"] for r in rows) or 1.0
    for r in rows:
        r["hours"] = round(r["minutes"] / 60, 2)
        r["duration_label"] = _fmt_duration(r["minutes"])
        r["pct_of_downtime"] = round((r["minutes"] / total_dt) * 100, 1)
        r["pct_of_planned"] = round((r["minutes"] / planned_minutes) * 100, 2) if planned_minutes else 0
        r["avg_minutes"] = round(r["minutes"] / r["count"], 1) if r["count"] else 0
        r["avg_duration_label"] = _fmt_duration(r["avg_minutes"])

    top = rows[:12]
    losses = [
        {
            "reason": r["reason"],
            "group": r["group"],
            "color": r["color"],
            "minutes": round(r["minutes"], 1),
            "count": r["count"],
            "pct_of_downtime": r["pct_of_downtime"],
            "duration_label": r["duration_label"],
        }
        for r in rows[:8]
    ]
    return top, losses


def _machine_compare(
    machines: list[Machine],
    prod_rows: list[ProductionRecord],
    dt_events: list[DowntimeEvent],
    days: int,
) -> list[dict[str, Any]]:
    prod_by: dict[int, dict[str, float]] = defaultdict(lambda: {"total": 0.0, "good": 0.0, "rejected": 0.0})
    for r in prod_rows:
        prod_by[r.machine_id]["total"] += r.total_units or 0
        prod_by[r.machine_id]["good"] += r.good_units or 0
        prod_by[r.machine_id]["rejected"] += r.rejected_units or 0

    dt_by: dict[int, float] = defaultdict(float)
    for ev in dt_events:
        if ev.machine_id:
            dt_by[ev.machine_id] += kpi_svc.downtime_minutes(ev.started_at, ev.ended_at) or 0

    out: list[dict[str, Any]] = []
    for m in machines:
        p = prod_by.get(m.id, {"total": 0.0, "good": 0.0, "rejected": 0.0})
        dt = dt_by.get(m.id, 0.0)
        metrics = _oee_from(days=days, machine_count=1, prod=p, dt_mins=dt)
        out.append(
            {
                "machine_id": m.id,
                "machine_code": m.machine_code,
                "machine_name": m.machine_name,
                "line_name": m.production_line.line_name if m.production_line else None,
                "oee": metrics["oee"],
                "availability": metrics["availability"],
                "performance": metrics["performance"],
                "quality": metrics["quality"],
                "downtime_minutes": round(dt, 1),
                "output": int(round(p["total"])),
                "good": int(round(p["good"])),
                "scrap": int(round(p["rejected"])),
            }
        )
    out.sort(key=lambda r: (r["oee"] is None, -(r["oee"] or 0)))
    return out


def build_management_report(
    db: Session,
    *,
    days: int = 30,
    department_id: int | None = None,
    line_id: int | None = None,
    machine_id: int | None = None,
    shift_id: int | None = None,
) -> dict[str, Any]:
    days = max(1, min(int(days), 90))
    start, end = _window(days)
    prev_end = start
    prev_start = prev_end - timedelta(days=days)

    machines = _scope_machines(
        db,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
    )
    machine_ids = [m.id for m in machines]
    scope = _scope_label(
        db,
        machines,
        department_id=department_id,
        line_id=line_id,
        machine_id=machine_id,
    )

    prod = _prod_rows(db, start, end, machine_ids, shift_id)
    prev_prod = _prod_rows(db, prev_start, prev_end, machine_ids, shift_id)
    events = _dt_events(db, start, end, machine_ids)
    prev_events = _dt_events(db, prev_start, prev_end, machine_ids)

    prod_sum = _sum_prod(prod)
    prev_sum = _sum_prod(prev_prod)
    dt_mins = _sum_dt(events)
    prev_dt = _sum_dt(prev_events)
    n = max(len(machines), 1)

    cur = _oee_from(days=days, machine_count=n, prod=prod_sum, dt_mins=dt_mins)
    prev = _oee_from(days=days, machine_count=n, prod=prev_sum, dt_mins=prev_dt)

    def _delta(a: float | None, b: float | None) -> float | None:
        if a is None or b is None:
            return None
        return round(a - b, 2)

    oee_trend, output_trend, downtime_by_day = _daily_series(days, end, prod, events, n)
    pareto, top_losses = _pareto(events, float(cur["planned_minutes"] or 1))
    compare = _machine_compare(machines, prod, events, days)

    shift_name = None
    if shift_id:
        sh = db.get(Shift, shift_id)
        shift_name = sh.shift_name if sh else None

    good = prod_sum["good"]
    scrap = prod_sum["rejected"]
    quality_mix = [
        {"name": "Good", "value": int(round(good)), "color": "#0f766e"},
        {"name": "Scrap", "value": int(round(scrap)), "color": "#be123c"},
    ]

    return {
        "generated_at": _utc_now().isoformat(),
        "filters_echo": {
            "days": days,
            "department_id": department_id,
            "line_id": line_id,
            "machine_id": machine_id,
            "shift_id": shift_id,
            "shift_name": shift_name,
        },
        "scope_label": scope,
        "machine_count": len(machines),
        "kpis": {
            "oee": cur["oee"],
            "availability": cur["availability"],
            "performance": cur["performance"],
            "quality": cur["quality"],
            "achievement": cur["achievement"],
            "downtime_minutes": round(dt_mins, 1),
            "good_units": int(round(good)),
            "total_units": int(round(prod_sum["total"])),
            "scrap_units": int(round(scrap)),
            "delta_oee": _delta(cur["oee"], prev["oee"]),
            "delta_availability": _delta(cur["availability"], prev["availability"]),
            "delta_performance": _delta(cur["performance"], prev["performance"]),
            "delta_quality": _delta(cur["quality"], prev["quality"]),
            "delta_downtime_minutes": _delta(dt_mins, prev_dt),
            "delta_good_units": _delta(good, prev_sum["good"]),
        },
        "oee_trend": oee_trend,
        "output_trend": output_trend,
        "downtime_pareto": {
            "total_minutes": round(dt_mins, 1),
            "rows": pareto,
        },
        "downtime_by_day": downtime_by_day,
        "machine_compare": compare,
        "quality_mix": quality_mix,
        "top_losses": top_losses,
        "single_machine": compare[0] if machine_id and compare else None,
    }
