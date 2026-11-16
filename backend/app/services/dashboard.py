from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.alert import Alert
from app.models.downtime import DowntimeEvent
from app.models.machine import Machine
from app.models.org import Department, ProductionLine
from app.models.production import ProductionRecord, ShiftNote
from app.models.shift import Shift
from app.models.work_order import WorkOrder
from app.services import kpi as kpi_svc

TIMELINE_START_HOUR = 6
TIMELINE_END_HOUR = 14  # default Day axis; live board uses active shift hours
GOAL_UTILIZATION = 60.0


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _day_bounds(date_str: str) -> tuple[datetime, datetime]:
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return day, day + timedelta(days=1)


def _prev_date(date_str: str) -> str:
    day = datetime.strptime(date_str, "%Y-%m-%d")
    return (day - timedelta(days=1)).strftime("%Y-%m-%d")


def _machine_filter(
    db: Session,
    site_id: int | None,
    department_id: int | None,
    line_id: int | None,
    machine_id: int | None = None,
) -> list[int]:
    q = (
        select(Machine.id)
        .join(ProductionLine, Machine.production_line_id == ProductionLine.id)
        .join(Department, ProductionLine.department_id == Department.id)
        .where(Machine.active.is_(True))
    )
    if machine_id:
        q = q.where(Machine.id == machine_id)
    if line_id:
        q = q.where(Machine.production_line_id == line_id)
    if department_id:
        q = q.where(ProductionLine.department_id == department_id)
    if site_id:
        q = q.where(Department.site_id == site_id)
    return list(db.scalars(q).all())


def _planned_seconds(db: Session, shift_id: int | None) -> float:
    """Net planned production seconds (gross shift minus typical startup/break/wind-down)."""
    from app.services.shift_structure import average_planned_loss_minutes_per_shift, net_planned_minutes_per_shift

    planned_seconds = net_planned_minutes_per_shift() * 60.0
    if shift_id:
        shift = db.get(Shift, shift_id)
        if shift:
            start_t = datetime.combine(datetime.utcnow().date(), shift.start_time)
            end_t = datetime.combine(datetime.utcnow().date(), shift.end_time)
            if end_t <= start_t:
                end_t += timedelta(days=1)
            gross_min = (end_t - start_t).total_seconds() / 60.0
            planned_seconds = max(gross_min - average_planned_loss_minutes_per_shift(), 60.0) * 60.0
    return planned_seconds


def _period_totals(
    db: Session,
    *,
    date: str,
    machine_ids: list[int],
    shift_id: int | None,
) -> dict[str, Any]:
    start, end = _day_bounds(date)
    if not machine_ids:
        return {
            "total_units": 0.0,
            "good_units": 0.0,
            "rejected_units": 0.0,
            "planned": 0.0,
            "downtime_minutes": 0.0,
            "availability": None,
            "records": [],
            "downtime_events": [],
            "work_orders": [],
        }

    prod_q = select(ProductionRecord).where(
        ProductionRecord.machine_id.in_(machine_ids),
        ProductionRecord.recorded_at >= start,
        ProductionRecord.recorded_at < end,
    )
    if shift_id:
        prod_q = prod_q.where(ProductionRecord.shift_id == shift_id)
    records = list(db.scalars(prod_q).all())

    total_units = sum(r.total_units for r in records)
    good_units = sum(r.good_units for r in records)
    rejected_units = sum(r.rejected_units for r in records)

    wo_q = (
        select(WorkOrder)
        .options(joinedload(WorkOrder.product))
        .where(
            WorkOrder.machine_id.in_(machine_ids),
            WorkOrder.status.in_(["In Progress", "Ready", "Paused", "Completed", "Planned"]),
        )
    )
    work_orders = list(db.scalars(wo_q).unique().all())
    planned = sum(wo.planned_quantity for wo in work_orders if wo.status != "Cancelled")
    if not records:
        total_units = sum(wo.actual_quantity for wo in work_orders)

    dt_q = (
        select(DowntimeEvent)
        .options(joinedload(DowntimeEvent.category))
        .where(
            DowntimeEvent.machine_id.in_(machine_ids),
            DowntimeEvent.started_at >= start,
            DowntimeEvent.started_at < end,
        )
    )
    downtime_events = list(db.scalars(dt_q).unique().all())
    downtime_minutes = 0.0
    for ev in downtime_events:
        downtime_minutes += (
            kpi_svc.downtime_minutes(_as_utc(ev.started_at), _as_utc(ev.ended_at) or end) or 0
        )

    planned_seconds = _planned_seconds(db, shift_id)
    operating_seconds = max(planned_seconds - (downtime_minutes * 60), 0)
    availability = kpi_svc.availability(operating_seconds, planned_seconds)

    return {
        "total_units": total_units,
        "good_units": good_units,
        "rejected_units": rejected_units,
        "planned": planned,
        "downtime_minutes": downtime_minutes,
        "availability": availability,
        "records": records,
        "downtime_events": downtime_events,
        "work_orders": work_orders,
        "planned_seconds": planned_seconds,
        "start": start,
        "end": end,
    }


def _format_duration_hours(minutes: float) -> str:
    total_minutes = int(round(minutes))
    hours = total_minutes // 60
    mins = total_minutes % 60
    if hours >= 1:
        return f"{hours}h {mins:02d}m"
    return f"{mins}m"


def _format_hours_decimal(minutes: float) -> str:
    return f"{minutes / 60:.1f}h"


def _format_cycle(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    if seconds >= 60:
        m = int(seconds // 60)
        s = int(round(seconds % 60))
        return f"{m}m {s:02d}s" if s else f"{m}m"
    return f"{seconds:.1f}s"


def _state_color(state: str) -> str:
    """Match station hourly timeline palette."""
    mapping = {
        "running": "green",
        "slow": "amber",
        "setup": "amber",
        "idle": "amber",
        "break": "break",
        "planned": "red",
        "structure": "planned",
        "unplanned": "red",
        "fault": "red",
        "offline": "red",
        "nodata": "future",
        "future": "future",
    }
    return mapping.get(state, "future")


def _classify_downtime(ev: DowntimeEvent) -> str:
    planned = (ev.category.planned_or_unplanned if ev.category else "unplanned") == "planned"
    name = (ev.category.category_name if ev.category else "") or ""
    reason = (ev.reason or "").lower()
    if "break" in reason or "lunch" in reason:
        return "break"
    if planned or name.lower() in {"changeover", "planned maintenance"} or "setup" in reason:
        return "setup" if "setup" in reason or name.lower() == "changeover" else "planned"
    if "fault" in reason or name.lower() in {"mechanical", "electrical"}:
        return "fault"
    return "unplanned"


def _build_timeline(
    *,
    machine: Machine,
    start: datetime,
    end: datetime,
    downtime_events: list[DowntimeEvent],
    has_production: bool,
) -> list[dict[str, Any]]:
    """Build day timeline from the same peppered shift sim as the station hourly view."""
    from app.services.station import (
        _active_shift_for,
        _clip_events,
        _factory_tz,
        _simulate_shift_events,
        _shift_window_for,
    )

    # Bar = active 8h shift (Day / Afternoon / Night) — same peppered sim as station
    tz = _factory_tz()
    now_local = datetime.now(tz)
    date_str = start.astimezone(tz).strftime("%Y-%m-%d") if start.tzinfo else start.strftime("%Y-%m-%d")
    shift_def = _active_shift_for(now_local if now_local.strftime("%Y-%m-%d") == date_str else now_local.replace(hour=12))
    # When viewing today use current shift; otherwise default Day on that date
    if now_local.strftime("%Y-%m-%d") == date_str:
        shift_start, shift_end = _shift_window_for(shift_def, now=now_local)
        view_now = min(max(now_local, shift_start), shift_end)
    else:
        from app.services.station import _shift_by_key

        shift_def = _shift_by_key("day")
        shift_start, shift_end = _shift_window_for(shift_def, now=now_local, date_str=date_str)
        view_now = shift_end if date_str < now_local.strftime("%Y-%m-%d") else shift_start
    shift_seconds = (shift_end - shift_start).total_seconds() or 1.0

    sim_events = _simulate_shift_events(
        machine.id,
        shift_start.strftime("%Y-%m-%d"),
        shift_start,
        shift_end,
        shift_key=shift_def["key"],
        break_label=str(shift_def.get("break_label") or "Break"),
    )
    live_events = _clip_events(sim_events, view_now)

    for ev in downtime_events:
        if ev.machine_id != machine.id:
            continue
        ev_start = _as_utc(ev.started_at)
        ev_end = _as_utc(ev.ended_at) or view_now.astimezone(timezone.utc)
        if not ev_start:
            continue
        a = ev_start.astimezone(tz)
        b = ev_end.astimezone(tz)
        if b <= shift_start or a >= shift_end:
            continue
        live_events.append(
            {
                "started_at": max(a, shift_start),
                "ended_at": min(b, view_now, shift_end),
                "state": _classify_downtime(ev),
                "label": ev.reason or (ev.category.category_name if ev.category else "Downtime"),
            }
        )
    live_events.sort(key=lambda e: e["started_at"])

    def pct_shift(dt: datetime) -> float:
        return max(0.0, min(100.0, (dt - shift_start).total_seconds() / shift_seconds * 100))

    segments: list[dict[str, Any]] = []
    cursor_pct = 0.0
    for ev in live_events:
        a = pct_shift(ev["started_at"])
        b = pct_shift(ev["ended_at"])
        if b <= a or b <= cursor_pct:
            continue
        a = max(a, cursor_pct)
        segments.append(
            {
                "start_pct": round(a, 2),
                "end_pct": round(b, 2),
                "state": ev["state"],
                "color": _state_color(ev["state"]),
                "label": ev["label"],
            }
        )
        cursor_pct = b

    view_pct = pct_shift(view_now)
    if view_pct < 100:
        segments.append(
            {
                "start_pct": round(max(cursor_pct, view_pct), 2),
                "end_pct": 100.0,
                "state": "future",
                "color": _state_color("future"),
                "label": "Upcoming",
            }
        )
    elif cursor_pct < 100 and not live_events and not has_production:
        state = "offline" if machine.status == "Offline" else "idle"
        segments.append(
            {
                "start_pct": round(cursor_pct, 2),
                "end_pct": 100.0,
                "state": state,
                "color": _state_color(state),
                "label": state.title(),
            }
        )
    elif cursor_pct < 100:
        segments.append(
            {
                "start_pct": round(cursor_pct, 2),
                "end_pct": 100.0,
                "state": "running",
                "color": _state_color("running"),
                "label": "Running",
            }
        )

    merged: list[dict[str, Any]] = []
    for seg in segments:
        if (
            merged
            and merged[-1]["state"] == seg["state"]
            and merged[-1]["label"] == seg["label"]
            and abs(merged[-1]["end_pct"] - seg["start_pct"]) < 0.05
        ):
            merged[-1]["end_pct"] = seg["end_pct"]
        else:
            merged.append(dict(seg))
    return merged


def build_dashboard(
    db: Session,
    *,
    date: str,
    site_id: int | None = None,
    department_id: int | None = None,
    line_id: int | None = None,
    shift_id: int | None = None,
    machine_id: int | None = None,
) -> dict[str, Any]:
    machine_ids = _machine_filter(db, site_id, department_id, line_id, machine_id)
    if not machine_ids:
        return _empty_dashboard(date)

    current = _period_totals(db, date=date, machine_ids=machine_ids, shift_id=shift_id)
    previous_date = _prev_date(date)
    previous = _period_totals(db, date=previous_date, machine_ids=machine_ids, shift_id=shift_id)

    records = current["records"]
    downtime_events = current["downtime_events"]
    work_orders = current["work_orders"]
    start, end = current["start"], current["end"]
    planned_seconds = current["planned_seconds"]

    total_units = current["total_units"]
    good_units = current["good_units"]
    rejected_units = current["rejected_units"]
    planned = current["planned"]
    total_downtime_min = current["downtime_minutes"]

    reason_totals: dict[str, float] = defaultdict(float)
    for ev in downtime_events:
        mins = kpi_svc.downtime_minutes(_as_utc(ev.started_at), _as_utc(ev.ended_at) or end) or 0
        label = ev.reason or (ev.category.category_name if ev.category else "Unclassified")
        reason_totals[label] += mins

    operating_seconds = max(planned_seconds - (total_downtime_min * 60), 0)
    ideal_cycle = 60.0
    cycles = [wo.product.ideal_cycle_time for wo in work_orders if wo.product]
    if cycles:
        ideal_cycle = sum(cycles) / len(cycles)

    avail = current["availability"]
    perf = kpi_svc.performance(ideal_cycle, total_units, operating_seconds) if total_units else None
    qual = kpi_svc.quality(good_units, total_units) if total_units else None
    oee_val = kpi_svc.oee(avail, perf, qual)
    ach = kpi_svc.achievement(total_units, planned) if planned else None

    prev_avail = previous["availability"]
    prev_ach = (
        kpi_svc.achievement(previous["total_units"], previous["planned"]) if previous["planned"] else None
    )

    def delta(curr: float | None, prev: float | None) -> float | None:
        if curr is None or prev is None:
            return None
        return round(curr - prev, 2)

    hourly_actual: dict[int, float] = defaultdict(float)
    for r in records:
        hourly_actual[r.recorded_at.hour] += r.total_units
    hourly_target = (planned / 8) if planned else 0
    hourly_trend = [
        {"hour": h, "actual": round(hourly_actual.get(h, 0), 2), "target": round(hourly_target, 2)}
        for h in range(6, 22)
    ]

    machines = list(
        db.scalars(
            select(Machine)
            .options(joinedload(Machine.production_line))
            .where(Machine.id.in_(machine_ids))
        )
        .unique()
        .all()
    )
    status_counts: dict[str, int] = defaultdict(int)
    machine_rows = []
    prev_records = previous["records"]

    for m in machines:
        status_counts[m.status] += 1
        m_recs = [r for r in records if r.machine_id == m.id]
        m_prev_recs = [r for r in prev_records if r.machine_id == m.id]
        m_total = sum(r.total_units for r in m_recs)
        m_prev_total = sum(r.total_units for r in m_prev_recs)
        m_good = sum(r.good_units for r in m_recs)
        m_rejected = sum(r.rejected_units for r in m_recs)
        m_wos = [wo for wo in work_orders if wo.machine_id == m.id]
        m_planned = sum(wo.planned_quantity for wo in m_wos) or 0
        active_wo = next((wo for wo in m_wos if wo.status == "In Progress"), m_wos[0] if m_wos else None)
        m_ideal = active_wo.product.ideal_cycle_time if active_wo and active_wo.product else ideal_cycle

        m_dt_events = [e for e in downtime_events if e.machine_id == m.id]
        m_dt = sum(
            (kpi_svc.downtime_minutes(_as_utc(e.started_at), _as_utc(e.ended_at) or end) or 0)
            for e in m_dt_events
        )
        m_op = max(planned_seconds - m_dt * 60, 0)
        m_avail = kpi_svc.availability(m_op, planned_seconds)
        m_perf = kpi_svc.performance(m_ideal, m_total, m_op) if m_total else None
        m_qual = kpi_svc.quality(m_good, m_total) if m_total else None
        m_oee = kpi_svc.oee(m_avail, m_perf, m_qual)
        m_ach = kpi_svc.achievement(m_total, m_planned) if m_planned else None

        # Actual cycle estimate from operating time / units
        actual_cycle = (m_op / m_total) if m_total > 0 and m_op > 0 else None
        cycle_delta = (actual_cycle - m_ideal) if actual_cycle is not None else None

        reason_map: dict[str, float] = defaultdict(float)
        for e in m_dt_events:
            label = e.reason or (e.category.category_name if e.category else "Unclassified")
            reason_map[label] += (
                kpi_svc.downtime_minutes(_as_utc(e.started_at), _as_utc(e.ended_at) or end) or 0
            )
        # Ensure demo machines show a few reasons even if sparse
        if not reason_map and m.status_source in {"demo", "seed", "simulated"} and m.status != "Running":
            if m.status == "Idle":
                reason_map["Waiting for Work"] = 90
            elif m.status == "Setup":
                reason_map["Setup"] = 40
            elif m.status == "Fault":
                reason_map["Drive fault"] = 70
            elif m.status == "Planned Stop":
                reason_map["Planned Maintenance"] = 45
            else:
                reason_map["Unplanned Stop"] = 30
            reason_map["Break / Lunch"] = 20

        downtime_reasons = [
            {"reason": k, "minutes": round(v, 1), "hours_label": _format_hours_decimal(v)}
            for k, v in sorted(reason_map.items(), key=lambda x: -x[1])[:4]
        ]

        machine_rows.append(
            {
                "id": m.id,
                "machine_code": m.machine_code,
                "machine_name": m.machine_name,
                "line_name": m.production_line.line_name if m.production_line else None,
                "status": m.status,
                "status_source": m.status_source,
                "last_update_at": m.last_update_at.isoformat() if m.last_update_at else None,
                "part_code": active_wo.product.product_code if active_wo and active_wo.product else None,
                "part_name": active_wo.product.product_name if active_wo and active_wo.product else None,
                "operation": active_wo.order_number if active_wo else None,
                "output": m_total,
                "previous_output": m_prev_total,
                "target": m_planned,
                "achievement": m_ach,
                "availability": m_avail,
                "utilization": m_avail,
                "utilization_goal": GOAL_UTILIZATION,
                "oee": m_oee,
                "performance": m_perf,
                "quality": m_qual,
                "downtime_minutes": round(m_dt, 2),
                "good_units": m_good,
                "rejected_units": m_rejected,
                "ideal_cycle_seconds": m_ideal,
                "actual_cycle_seconds": round(actual_cycle, 1) if actual_cycle else None,
                "cycle_delta_seconds": round(cycle_delta, 1) if cycle_delta is not None else None,
                "cycle_label": f"{_format_cycle(actual_cycle)} vs {_format_cycle(m_ideal)}"
                if actual_cycle
                else f"— vs {_format_cycle(m_ideal)}",
                "downtime_reasons": downtime_reasons,
                "timeline": _build_timeline(
                    machine=m,
                    start=start,
                    end=end,
                    downtime_events=m_dt_events,
                    has_production=m_total > 0,
                ),
            }
        )

    alerts = list(
        db.scalars(
            select(Alert)
            .where(Alert.status.in_(["Open", "Acknowledged"]))
            .order_by(Alert.created_at.desc())
            .limit(20)
        ).all()
    )
    notes_q = select(ShiftNote).where(ShiftNote.note_date >= start, ShiftNote.note_date < end)
    if shift_id:
        notes_q = notes_q.where(ShiftNote.shift_id == shift_id)
    notes = list(db.scalars(notes_q.order_by(ShiftNote.created_at.desc()).limit(10)).all())

    sources = {r.source for r in records} | {m.status_source for m in machines}
    is_demo = any(s in ("demo", "simulated", "seed") for s in sources) or not records

    date_obj = datetime.strptime(date, "%Y-%m-%d")
    prev_obj = datetime.strptime(previous_date, "%Y-%m-%d")

    from app.services.station import (
        _active_shift_for as _dash_active_shift,
        _factory_tz as _dash_tz,
        _shift_hour_starts,
        _shift_window_for as _dash_window,
    )

    _tz = _dash_tz()
    _now = datetime.now(_tz)
    _shift = _dash_active_shift(_now)
    _s0, _s1 = _dash_window(_shift, now=_now)
    _axis = [h.hour for h in _shift_hour_starts(_s0, _s1)] + [_s1.hour]

    return {
        "date": date,
        "compare_date": previous_date,
        "date_label": date_obj.strftime("%b %d, %Y"),
        "compare_label": prev_obj.strftime("%b %d"),
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "demo_mode": is_demo,
        "active_shift": {
            "key": _shift["key"],
            "name": _shift["name"],
            "label": f"{_shift['name']} {_s0.strftime('%H:%M')}–{_s1.strftime('%H:%M')}",
        },
        "timeline_hours": _axis,
        "timeline_shift_start": _s0.hour,
        "timeline_shift_hours": 8,
        "kpis": {
            "planned_production": round(planned, 2),
            "actual_production": round(total_units, 2),
            "previous_production": round(previous["total_units"], 2),
            "production_delta": round(total_units - previous["total_units"], 2),
            "achievement": ach,
            "previous_achievement": prev_ach,
            "achievement_delta_pp": delta(ach, prev_ach),
            "good_units": round(good_units, 2),
            "rejected_units": round(rejected_units, 2),
            "oee": oee_val,
            "availability": avail,
            "previous_availability": prev_avail,
            "availability_delta_pp": delta(avail, prev_avail),
            "utilization": avail,
            "utilization_goal": GOAL_UTILIZATION,
            "performance": perf,
            "quality": qual,
            "rejection_rate": kpi_svc.rejection_rate(rejected_units, total_units) if total_units else None,
            "total_downtime_minutes": round(total_downtime_min, 2),
            "previous_downtime_minutes": round(previous["downtime_minutes"], 2),
            "downtime_delta_minutes": round(total_downtime_min - previous["downtime_minutes"], 2),
            "downtime_label": _format_duration_hours(total_downtime_min),
            "downtime_delta_label": _format_duration_hours(abs(total_downtime_min - previous["downtime_minutes"])),
        },
        "hourly_trend": hourly_trend,
        "machine_status": dict(status_counts),
        "machines": machine_rows,
        "downtime": {
            "total_minutes": round(total_downtime_min, 2),
            "by_reason": [
                {"reason": k, "minutes": round(v, 2)}
                for k, v in sorted(reason_totals.items(), key=lambda x: -x[1])
            ],
        },
        "quality": {
            "good_units": round(good_units, 2),
            "rejected_units": round(rejected_units, 2),
            "rejection_rate": kpi_svc.rejection_rate(rejected_units, total_units) if total_units else None,
        },
        "alerts": [
            {
                "id": a.id,
                "alert_type": a.alert_type,
                "severity": a.severity,
                "message": a.message,
                "status": a.status,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "machine_id": a.machine_id,
            }
            for a in alerts
        ],
        "shift_notes": [
            {
                "id": n.id,
                "content": n.content,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "author_id": n.author_id,
            }
            for n in notes
        ],
    }


def _empty_dashboard(date: str) -> dict[str, Any]:
    previous_date = _prev_date(date)
    return {
        "date": date,
        "compare_date": previous_date,
        "date_label": date,
        "compare_label": previous_date,
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "demo_mode": True,
        "timeline_hours": list(range(0, 25, 2)),
        "kpis": {
            "planned_production": 0,
            "actual_production": 0,
            "previous_production": 0,
            "production_delta": 0,
            "achievement": None,
            "previous_achievement": None,
            "achievement_delta_pp": None,
            "good_units": 0,
            "rejected_units": 0,
            "oee": None,
            "availability": None,
            "previous_availability": None,
            "availability_delta_pp": None,
            "utilization": None,
            "utilization_goal": GOAL_UTILIZATION,
            "performance": None,
            "quality": None,
            "rejection_rate": None,
            "total_downtime_minutes": 0,
            "previous_downtime_minutes": 0,
            "downtime_delta_minutes": 0,
            "downtime_label": "0m",
            "downtime_delta_label": "0m",
        },
        "hourly_trend": [{"hour": h, "actual": 0, "target": 0} for h in range(6, 22)],
        "machine_status": {},
        "machines": [],
        "downtime": {"total_minutes": 0, "by_reason": []},
        "quality": {"good_units": 0, "rejected_units": 0, "rejection_rate": None},
        "alerts": [],
        "shift_notes": [],
    }
