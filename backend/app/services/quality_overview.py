"""Quality desk aggregates for the Quality page."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.machine import Machine
from app.models.production import QualityRecord
from app.models.work_order import WorkOrder

DEFECT_COLORS: dict[str, str] = {
    "Dimensional": "#0369a1",
    "Surface": "#b45309",
    "Missing feature": "#2f4541",
    "Flash": "#be123c",
    "Uncategorized": "#64748b",
    "Other": "#0f766e",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _yield_pct(good: float, scrap: float) -> float | None:
    total = good + scrap
    if total <= 0:
        return None
    return round((good / total) * 100, 2)


def _scrap_rate(good: float, scrap: float) -> float | None:
    total = good + scrap
    if total <= 0:
        return None
    return round((scrap / total) * 100, 2)


def _sum_rows(rows: list[QualityRecord]) -> tuple[float, float]:
    good = float(sum(r.good_units or 0 for r in rows))
    scrap = float(sum(r.rejected_units or 0 for r in rows))
    return good, scrap


def build_quality_overview(
    db: Session,
    *,
    days: int = 14,
    machine_id: int | None = None,
) -> dict[str, Any]:
    days = max(1, min(int(days), 90))
    end = _utc_now()
    start = end - timedelta(days=days)
    prev_end = start
    prev_start = prev_end - timedelta(days=days)

    q = (
        select(QualityRecord)
        .options(
            joinedload(QualityRecord.machine),
            joinedload(QualityRecord.work_order),
        )
        .where(
            QualityRecord.inspected_at >= start,
            QualityRecord.inspected_at < end,
        )
    )
    if machine_id:
        q = q.where(QualityRecord.machine_id == machine_id)
    rows = list(db.scalars(q.order_by(QualityRecord.inspected_at.desc())).unique().all())

    pq = select(QualityRecord).where(
        QualityRecord.inspected_at >= prev_start,
        QualityRecord.inspected_at < prev_end,
    )
    if machine_id:
        pq = pq.where(QualityRecord.machine_id == machine_id)
    prev_rows = list(db.scalars(pq).all())

    good, scrap = _sum_rows(rows)
    prev_good, prev_scrap = _sum_rows(prev_rows)
    yield_now = _yield_pct(good, scrap)
    yield_prev = _yield_pct(prev_good, prev_scrap)
    rate_now = _scrap_rate(good, scrap)
    rate_prev = _scrap_rate(prev_good, prev_scrap)

    def _delta(a: float | None, b: float | None) -> float | None:
        if a is None or b is None:
            return None
        return round(a - b, 2)

    # Daily trend
    by_day: dict[date, dict[str, float]] = defaultdict(lambda: {"good": 0.0, "scrap": 0.0})
    for r in rows:
        d = r.inspected_at.date() if hasattr(r.inspected_at, "date") else start.date()
        by_day[d]["good"] += r.good_units or 0
        by_day[d]["scrap"] += r.rejected_units or 0

    daily_trend: list[dict[str, Any]] = []
    cursor = (end - timedelta(days=days - 1)).date()
    last = end.date()
    while cursor <= last:
        cell = by_day.get(cursor, {"good": 0.0, "scrap": 0.0})
        daily_trend.append(
            {
                "date": cursor.isoformat(),
                "label": cursor.strftime("%d %b"),
                "good": int(round(cell["good"])),
                "scrap": int(round(cell["scrap"])),
                "yield_pct": _yield_pct(cell["good"], cell["scrap"]),
            }
        )
        cursor += timedelta(days=1)

    # Defect mix
    mix_buckets: dict[str, dict[str, Any]] = {}
    for r in rows:
        cat = (r.defect_category or "").strip() or "Uncategorized"
        if cat not in mix_buckets:
            mix_buckets[cat] = {
                "category": cat,
                "count": 0,
                "rejected_units": 0.0,
                "color": DEFECT_COLORS.get(cat, "#64748b"),
            }
        mix_buckets[cat]["count"] += 1
        mix_buckets[cat]["rejected_units"] += r.rejected_units or 0
    defect_mix = sorted(mix_buckets.values(), key=lambda x: x["rejected_units"], reverse=True)
    for item in defect_mix:
        item["rejected_units"] = int(round(item["rejected_units"]))

    # By machine
    machines = {
        m.id: m
        for m in db.scalars(select(Machine).where(Machine.active.is_(True))).all()
    }
    m_buckets: dict[int, dict[str, Any]] = {}
    for r in rows:
        mid = r.machine_id
        if mid not in m_buckets:
            m = r.machine or machines.get(mid)
            m_buckets[mid] = {
                "machine_id": mid,
                "machine_code": m.machine_code if m else f"#{mid}",
                "machine_name": m.machine_name if m else "—",
                "good": 0.0,
                "scrap": 0.0,
                "inspections": 0,
                "last_inspected_at": None,
            }
        b = m_buckets[mid]
        b["good"] += r.good_units or 0
        b["scrap"] += r.rejected_units or 0
        b["inspections"] += 1
        ts = r.inspected_at.isoformat() if r.inspected_at else None
        if ts and (b["last_inspected_at"] is None or ts > b["last_inspected_at"]):
            b["last_inspected_at"] = ts

    by_machine: list[dict[str, Any]] = []
    for b in m_buckets.values():
        g, s = b["good"], b["scrap"]
        by_machine.append(
            {
                "machine_id": b["machine_id"],
                "machine_code": b["machine_code"],
                "machine_name": b["machine_name"],
                "good": int(round(g)),
                "scrap": int(round(s)),
                "inspections": b["inspections"],
                "yield_pct": _yield_pct(g, s),
                "scrap_rate": _scrap_rate(g, s),
                "last_inspected_at": b["last_inspected_at"],
            }
        )
    by_machine.sort(key=lambda m: (m["scrap_rate"] is None, -(m["scrap_rate"] or 0)))

    worst = by_machine[0] if by_machine and (by_machine[0].get("scrap") or 0) > 0 else None

    # Recent feed
    wo_cache: dict[int, str] = {}
    recent: list[dict[str, Any]] = []
    for r in rows[:40]:
        m = r.machine or machines.get(r.machine_id)
        wo_label = None
        if r.work_order_id:
            if r.work_order_id not in wo_cache:
                wo = r.work_order or db.get(WorkOrder, r.work_order_id)
                wo_cache[r.work_order_id] = wo.order_number if wo else f"WO#{r.work_order_id}"
            wo_label = wo_cache[r.work_order_id]
        recent.append(
            {
                "id": r.id,
                "inspected_at": r.inspected_at.isoformat() if r.inspected_at else None,
                "machine_id": r.machine_id,
                "machine_code": m.machine_code if m else f"#{r.machine_id}",
                "machine_name": m.machine_name if m else None,
                "work_order_id": r.work_order_id,
                "work_order_number": wo_label,
                "good_units": int(round(r.good_units or 0)),
                "rejected_units": int(round(r.rejected_units or 0)),
                "defect_category": r.defect_category,
                "notes": r.notes,
                "corrective_action": r.corrective_action,
            }
        )

    return {
        "generated_at": end.isoformat(),
        "filters_echo": {"days": days, "machine_id": machine_id},
        "kpis": {
            "yield_pct": yield_now,
            "scrap_units": int(round(scrap)),
            "good_units": int(round(good)),
            "total_units": int(round(good + scrap)),
            "scrap_rate": rate_now,
            "inspections": len(rows),
            "worst_machine": (
                {
                    "machine_id": worst["machine_id"],
                    "machine_code": worst["machine_code"],
                    "scrap_rate": worst["scrap_rate"],
                    "scrap": worst["scrap"],
                }
                if worst
                else None
            ),
            "delta_yield_pct": _delta(yield_now, yield_prev),
            "delta_scrap_units": _delta(scrap, prev_scrap),
            "delta_scrap_rate": _delta(rate_now, rate_prev),
            "delta_inspections": len(rows) - len(prev_rows),
        },
        "daily_trend": daily_trend,
        "defect_mix": defect_mix,
        "by_machine": by_machine,
        "recent": recent,
    }
