"""Single-machine station board — 3×8h shifts with live simulation."""

from __future__ import annotations

import hashlib
import random
from collections import defaultdict
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.models.downtime import DowntimeEvent
from app.models.machine import Machine
from app.models.production import ProductionRecord
from app.models.work_order import WorkOrder
from app.services import kpi as kpi_svc
from app.services.plant_catalog import PLANT, profile_for_machine
from app.services.shift_structure import build_shift_structure_windows, structure_as_blocked

# Three rotating 8-hour shifts (night wraps past midnight)
SHIFTS: list[dict[str, Any]] = [
    {
        "key": "day",
        "name": "Day",
        "start_hour": 6,
        "end_hour": 14,
        "break_label": "Break / Lunch",
    },
    {
        "key": "afternoon",
        "name": "Afternoon",
        "start_hour": 14,
        "end_hour": 22,
        "break_label": "Break",
    },
    {
        "key": "night",
        "name": "Night",
        "start_hour": 22,
        "end_hour": 6,
        "break_label": "Break",
    },
]
SHIFT_HOURS = 8
# Back-compat aliases (day shift)
SHIFT_START_HOUR = 6
SHIFT_END_HOUR = 14
SLOW_RATE_FACTOR = 0.45


def _factory_tz() -> tzinfo:
    """Resolve factory timezone; fall back to UTC+3 if tz database is unavailable."""
    name = get_settings().factory_timezone
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:
        # Common East Africa offset used by default Octavia config
        return timezone(timedelta(hours=3), name=name)


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _day_bounds_local(date_str: str, tz: tzinfo) -> tuple[datetime, datetime]:
    day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
    return day, day + timedelta(days=1)


def _shift_by_key(key: str | None) -> dict[str, Any]:
    if key:
        for s in SHIFTS:
            if s["key"] == key:
                return s
    return SHIFTS[0]


def _shift_contains_hour(shift: dict[str, Any], hour: int) -> bool:
    sh, eh = int(shift["start_hour"]), int(shift["end_hour"])
    if sh < eh:
        return sh <= hour < eh
    return hour >= sh or hour < eh


def _active_shift_for(now: datetime) -> dict[str, Any]:
    for s in SHIFTS:
        if _shift_contains_hour(s, now.hour):
            return s
    return SHIFTS[0]


def _shift_window_for(
    shift: dict[str, Any],
    *,
    now: datetime,
    date_str: str | None = None,
) -> tuple[datetime, datetime]:
    """Return [start, end) for a shift. Night may cross midnight."""
    tz = now.tzinfo
    sh, eh = int(shift["start_hour"]), int(shift["end_hour"])
    if date_str:
        anchor = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=tz)
        start = anchor + timedelta(hours=sh)
        end = (anchor + timedelta(days=1 if eh <= sh else 0)) + timedelta(hours=eh)
        return start, end

    # Resolve window that contains `now`
    local_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if sh < eh:
        return local_day + timedelta(hours=sh), local_day + timedelta(hours=eh)
    # Overnight
    if now.hour >= sh:
        start = local_day + timedelta(hours=sh)
        end = local_day + timedelta(days=1, hours=eh)
    else:
        start = local_day - timedelta(days=1) + timedelta(hours=sh)
        end = local_day + timedelta(hours=eh)
    return start, end


def _shift_hour_starts(shift_start: datetime, shift_end: datetime) -> list[datetime]:
    hours: list[datetime] = []
    cursor = shift_start.replace(minute=0, second=0, microsecond=0)
    if cursor < shift_start:
        cursor += timedelta(hours=1)
    # Prefer exact hour ticks from shift_start
    cursor = shift_start
    while cursor < shift_end:
        hours.append(cursor)
        cursor += timedelta(hours=1)
    return hours


def _shift_window(day_start: datetime) -> tuple[datetime, datetime]:
    """Back-compat: day shift window on the given local day."""
    return (
        day_start + timedelta(hours=SHIFT_START_HOUR),
        day_start + timedelta(hours=SHIFT_END_HOUR),
    )


def _shift_availability(
    shift: dict[str, Any],
    *,
    date_str: str,
    now: datetime,
) -> dict[str, Any]:
    """Mark whether a shift can be viewed for a calendar day.

    For *today*: only shifts that have already started (or are live) are listed —
    e.g. during Afternoon, Night is hidden until 22:00. Past days expose all three.
    """
    start, end = _shift_window_for(shift, now=now, date_str=date_str)
    today = now.strftime("%Y-%m-%d")
    item = {
        "key": shift["key"],
        "name": shift["name"],
        "start_hour": shift["start_hour"],
        "end_hour": shift["end_hour"],
        "label": f"{shift['name']} {shift['start_hour']:02d}:00–{shift['end_hour']:02d}:00",
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
    }
    # Window first: overnight Night is anchored to yesterday's date_str but still live after midnight.
    if start <= now < end:
        item["state"] = "live"
        item["available"] = True
    elif date_str > today or now < start:
        item["state"] = "upcoming"
        item["available"] = False
    else:
        item["state"] = "done"
        item["available"] = True
    return item


def _available_shifts_for(date_str: str, now: datetime) -> list[dict[str, Any]]:
    return [
        item
        for s in SHIFTS
        if (item := _shift_availability(s, date_str=date_str, now=now))["available"]
    ]


def _shift_public(
    shift: dict[str, Any],
    shift_start: datetime,
    shift_end: datetime,
    *,
    date_str: str,
    now: datetime,
) -> dict[str, Any]:
    labels = [h.strftime("%H") for h in _shift_hour_starts(shift_start, shift_end)]
    axis = [int(h.strftime("%H")) for h in _shift_hour_starts(shift_start, shift_end)]
    axis.append(int(shift_end.strftime("%H")) if shift_end.hour or shift["end_hour"] == 0 else 24)
    available = _available_shifts_for(date_str, now)
    current = next((a for a in available if a["key"] == shift["key"]), None)
    return {
        "key": shift["key"],
        "name": shift["name"],
        "start_hour": shift["start_hour"],
        "end_hour": shift["end_hour"],
        "hours": SHIFT_HOURS,
        "start_at": shift_start.isoformat(),
        "end_at": shift_end.isoformat(),
        "label": f"{shift['name']} {shift_start.strftime('%H:%M')}–{shift_end.strftime('%H:%M')}",
        "hour_labels": labels,
        "axis_hours": axis,
        "state": (current or {}).get("state") or ("live" if shift_start <= now <= shift_end else "done"),
        "all": available,
        "selectable_dates": {
            "max": now.strftime("%Y-%m-%d"),
            # keep a short lookback window for reviewing prior performance
            "min": (now - timedelta(days=14)).strftime("%Y-%m-%d"),
        },
    }


def _state_color(state: str) -> str:
    return {
        "running": "green",
        "slow": "amber",
        "setup": "amber",
        "break": "break",
        # Coded / major planned stops stay issue-red (do not grey out after a reason is added)
        "planned": "red",
        "fault": "red",
        "unplanned": "red",
        "idle": "amber",
        "offline": "red",
        # Shift start / end structure windows keep the slate band
        "structure": "planned",
        "nodata": "muted",
        "future": "future",
    }.get(state, "muted")


def _classify_db(ev: DowntimeEvent) -> str:
    planned = (ev.category.planned_or_unplanned if ev.category else "unplanned") == "planned"
    reason = (ev.reason or "").lower()
    name = (ev.category.category_name if ev.category else "").lower()
    if "break" in reason or "lunch" in reason or name == "break":
        return "break"
    if planned or name in {"changeover", "planned maintenance", "setup", "maintenance"} or "setup" in reason or "changeover" in reason:
        return "setup" if "setup" in reason or "changeover" in reason or name == "setup" else "planned"
    if "fault" in reason or name in {"mechanical", "electrical", "technical"}:
        return "fault"
    return "unplanned"


def _rng_for(machine_id: int, date_str: str, shift_key: str = "day") -> random.Random:
    digest = hashlib.sha256(
        f"octavia-sim-v4-{machine_id}-{date_str}-{shift_key}".encode()
    ).hexdigest()
    return random.Random(int(digest[:16], 16))


MICRO_DELAYS = [
    ("slow", "Short delay"),
    ("slow", "Slow cycle"),
    ("slow", "Purge / drip"),
    ("idle", "Operator check"),
    ("idle", "Waiting for material"),
    ("slow", "Temperature settle"),
    ("slow", "Gate jam clear"),
]

MAJOR_EVENTS = [
    ("planned", "Mould cleaning", (6, 14), "tool", False),
    ("planned", "Hopper clean", (5, 12), "tool", False),
    ("setup", "Colour changeover", (8, 20), "tool", False),
    ("setup", "Tool change", (10, 22), "tool", False),
    ("unplanned", "Material shortage", (4, 12), "alert", False),
    ("fault", "Heater fault", (5, 15), "alert", False),
    ("fault", "Hydraulic issue", (6, 18), "alert", False),
    ("unplanned", "Quality hold", (3, 10), "alert", False),
    ("unplanned", "Supplies missing", (5, 12), "alert", False),
    ("fault", "Machine reset", (4, 11), "alert", False),
]


def _overlaps(a0: datetime, a1: datetime, b0: datetime, b1: datetime) -> bool:
    return a0 < b1 and b0 < a1


def _simulate_shift_events(
    machine_id: int,
    date_str: str,
    shift_start: datetime,
    shift_end: datetime,
    *,
    shift_key: str = "day",
    break_label: str = "Break / Lunch",
) -> list[dict[str, Any]]:
    """Plastics-line style shift: startup wait, mid break, wind-down, plus shop-floor losses."""
    rng = _rng_for(machine_id, date_str, shift_key)
    blocked: list[tuple[datetime, datetime, dict[str, Any]]] = []

    # Structured non-production: ~10 min start, 10–30 min break, ~10 min end
    structure = build_shift_structure_windows(
        shift_start,
        shift_end,
        rng,
        break_label=break_label,
    )
    blocked.extend(structure_as_blocked(structure))

    startup_end = next((w.end for w in structure if w.kind == "startup"), shift_start)
    wind_start = next((w.start for w in structure if w.kind == "winddown"), shift_end)

    # Always place one uncommented stop after startup (still early in the shift)
    unc_dur = timedelta(minutes=rng.randint(8, 14))
    unc_earliest = startup_end + timedelta(minutes=2)
    unc_latest = min(startup_end + timedelta(minutes=50), wind_start - unc_dur - timedelta(minutes=5))
    if unc_latest > unc_earliest:
        span = int((unc_latest - unc_earliest).total_seconds() // 60)
        unc_start = unc_earliest + timedelta(minutes=rng.randint(0, max(span, 1)))
        unc_end = unc_start + unc_dur
        if not any(_overlaps(unc_start, unc_end, b0, b1) for b0, b1, _ in blocked):
            blocked.append(
                (
                    unc_start,
                    unc_end,
                    {
                        "state": "unplanned",
                        "label": "Uncommented",
                        "marker": "alert",
                        "needs_reason": True,
                    },
                )
            )
        elif not any(meta.get("needs_reason") for _, _, meta in blocked):
            first = min(blocked, key=lambda b: b[0])
            start = max(first[1] + timedelta(minutes=2), startup_end + timedelta(minutes=2))
            end = start + unc_dur
            if end < wind_start - timedelta(minutes=10):
                blocked.append(
                    (
                        start,
                        end,
                        {
                            "state": "unplanned",
                            "label": "Uncommented",
                            "marker": "alert",
                            "needs_reason": True,
                        },
                    )
                )

    # 2–4 additional longer shop-floor issues
    for _ in range(rng.randint(2, 4)):
        state, label, (lo, hi), marker, needs_reason = rng.choice(MAJOR_EVENTS)
        # Prefer labeled majors here; uncommented already guaranteed above
        if needs_reason:
            state, label, (lo, hi), marker, needs_reason = rng.choice(
                [e for e in MAJOR_EVENTS if not e[4]] or MAJOR_EVENTS
            )
        dur = timedelta(minutes=rng.randint(lo, hi))
        latest = wind_start - dur - timedelta(minutes=5)
        earliest = startup_end + timedelta(minutes=10)
        if latest <= earliest:
            continue
        span_minutes = int((latest - earliest).total_seconds() // 60)
        start = earliest + timedelta(minutes=rng.randint(0, max(span_minutes, 1)))
        end = start + dur
        if any(_overlaps(start, end, b0, b1) for b0, b1, _ in blocked):
            continue
        blocked.append(
            (
                start,
                end,
                {
                    "state": state,
                    "label": label,
                    "marker": marker,
                    "needs_reason": needs_reason,
                },
            )
        )

    blocked.sort(key=lambda x: x[0])

    # Walk the shift: between blocked majors, fill with running + frequent micro-delays
    events: list[dict[str, Any]] = []
    cursor = shift_start
    block_i = 0

    def _pepper_running(run_start: datetime, run_end: datetime) -> None:
        """Insert short yellow delays so a full half-hour of pure green is uncommon."""
        if run_end <= run_start:
            return
        t = run_start
        while t < run_end:
            # Productive burst — usually only a few minutes before a blip
            burst = timedelta(minutes=rng.randint(2, 11), seconds=rng.randint(0, 50))
            burst_end = min(t + burst, run_end)
            if burst_end > t:
                events.append(
                    {
                        "started_at": t,
                        "ended_at": burst_end,
                        "state": "running",
                        "needs_reason": False,
                        "label": "Running",
                        "marker": None,
                    }
                )
            t = burst_end
            if t >= run_end:
                break
            # Short shop-floor delay / slow movement
            state, label = rng.choice(MICRO_DELAYS)
            # Bias: ~70% true short delay, ~20% slightly longer slow, ~10% brief idle
            roll = rng.random()
            if roll < 0.55:
                delay = timedelta(seconds=rng.randint(25, 90))
                state, label = "slow", rng.choice(["Short delay", "Slow cycle", "Purge / drip"])
            elif roll < 0.82:
                delay = timedelta(minutes=rng.randint(1, 3), seconds=rng.randint(0, 40))
                state, label = "slow", rng.choice(["Slow movement", "Cooling wait", "Gate jam clear"])
            else:
                delay = timedelta(minutes=rng.randint(1, 4), seconds=rng.randint(0, 30))
                state, label = "idle", rng.choice(["Operator check", "Waiting for material", "Box change"])
            delay_end = min(t + delay, run_end)
            if delay_end > t:
                events.append(
                    {
                        "started_at": t,
                        "ended_at": delay_end,
                        "state": state,
                        "label": label,
                        # Keep the bar clean — markers only on major events
                        "marker": None,
                        "needs_reason": False,
                    }
                )
            t = delay_end

    while cursor < shift_end:
        next_block = blocked[block_i] if block_i < len(blocked) else None
        if next_block and cursor >= next_block[1]:
            block_i += 1
            continue
        if next_block and cursor < next_block[0]:
            _pepper_running(cursor, next_block[0])
            cursor = next_block[0]
            continue
        if next_block:
            b0, b1, meta = next_block
            events.append(
                {
                    "started_at": b0,
                    "ended_at": min(b1, shift_end),
                    "state": meta["state"],
                    "label": meta["label"],
                    "marker": meta.get("marker"),
                    "needs_reason": bool(meta.get("needs_reason")),
                }
            )
            cursor = min(b1, shift_end)
            block_i += 1
            continue
        _pepper_running(cursor, shift_end)
        break

    events.sort(key=lambda e: e["started_at"])
    return events


def _clip_events(events: list[dict[str, Any]], until: datetime) -> list[dict[str, Any]]:
    out = []
    for ev in events:
        if ev["started_at"] >= until:
            break
        out.append({**ev, "ended_at": min(ev["ended_at"], until)})
    return out


def _current_state(events: list[dict[str, Any]], now: datetime) -> str:
    for ev in reversed(events):
        if ev["started_at"] <= now <= ev["ended_at"]:
            return ev["state"]
    return "running" if events else "nodata"


def _seg_payload(
    *,
    start_pct: float,
    end_pct: float,
    state: str,
    label: str,
    needs_reason: bool = False,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "start_pct": round(start_pct, 2),
        "end_pct": round(end_pct, 2),
        "state": state,
        "color": _state_color(state),
        "label": label,
        "needs_reason": bool(needs_reason),
    }
    if started_at is not None:
        payload["started_at"] = started_at.isoformat()
    if ended_at is not None:
        payload["ended_at"] = ended_at.isoformat()
    return payload


def _as_factory_local(dt: datetime | None, tz: tzinfo) -> datetime | None:
    """Interpret naive DB timestamps as factory-local wall clock (common MySQL pattern)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _apply_coded_reasons(
    events: list[dict[str, Any]],
    downtime_db: list[DowntimeEvent],
    tz: tzinfo,
) -> list[dict[str, Any]]:
    """Replace uncommented sim stops with overlapping coded DB downtime reasons."""
    coded: list[tuple[datetime, datetime, str, str]] = []
    for d in downtime_db:
        started = _as_factory_local(d.started_at, tz)
        ended = _as_factory_local(d.ended_at, tz)
        if not started or not ended:
            continue
        reason = (d.reason or "").strip()
        if not reason or reason.lower() == "uncommented":
            continue
        state = _classify_db(d)
        coded.append((started, ended, reason, state))

    if not coded:
        return events

    out: list[dict[str, Any]] = []
    for ev in events:
        if not ev.get("needs_reason") and (ev.get("label") or "").lower() != "uncommented":
            out.append(ev)
            continue
        match = next(
            (
                c
                for c in coded
                if _overlaps(ev["started_at"], ev["ended_at"], c[0], c[1])
                and (min(ev["ended_at"], c[1]) - max(ev["started_at"], c[0])).total_seconds() >= 60
            ),
            None,
        )
        if match:
            out.append(
                {
                    **ev,
                    "label": match[2],
                    "state": match[3],
                    "needs_reason": False,
                    "marker": "tool" if match[3] in {"setup", "planned"} else "alert",
                }
            )
        else:
            out.append(ev)
    return out


def _hour_segments(
    events: list[dict[str, Any]],
    hour_start: datetime,
    hour_end: datetime,
    now: datetime,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    if hour_start >= now:
        return (
            [
                _seg_payload(
                    start_pct=0,
                    end_pct=100,
                    state="future",
                    label="Upcoming",
                )
            ],
            [],
            "future",
        )

    visible_end = min(hour_end, now)
    fill_pct = (visible_end - hour_start).total_seconds() / 3600 * 100

    segs: list[dict[str, Any]] = []
    markers: list[dict[str, Any]] = []
    relevant = [
        ev
        for ev in events
        if ev["started_at"] < visible_end and ev["ended_at"] > hour_start
    ]

    cursor = 0.0
    for ev in relevant:
        seg_start = max(ev["started_at"], hour_start)
        seg_end = min(ev["ended_at"], visible_end)
        a = max(0.0, (seg_start - hour_start).total_seconds() / 3600 * 100)
        b = min(fill_pct, (seg_end - hour_start).total_seconds() / 3600 * 100)
        if b <= a:
            continue
        if a > cursor + 0.05:
            gap_start = hour_start + timedelta(minutes=cursor * 0.6)
            gap_end = hour_start + timedelta(minutes=a * 0.6)
            segs.append(
                _seg_payload(
                    start_pct=cursor,
                    end_pct=a,
                    state="running",
                    label="Running",
                    started_at=gap_start,
                    ended_at=gap_end,
                )
            )
        segs.append(
            _seg_payload(
                start_pct=a,
                end_pct=b,
                state=ev["state"],
                label=ev["label"],
                needs_reason=bool(ev.get("needs_reason")),
                started_at=seg_start,
                ended_at=seg_end,
            )
        )
        marker_kind = ev.get("marker")
        if not marker_kind and ev["state"] in {"fault", "setup", "planned", "unplanned"}:
            marker_kind = "alert" if ev["state"] in {"fault", "unplanned"} else "tool"
        if marker_kind in {"tool", "alert", "sync"}:
            markers.append(
                {
                    "pct": round(a + 0.6, 2),
                    "kind": marker_kind if marker_kind != "sync" else "tool",
                    "label": ev["label"],
                }
            )
        cursor = max(cursor, b)

    if cursor < fill_pct:
        segs.append(
            _seg_payload(
                start_pct=cursor,
                end_pct=fill_pct,
                state="running",
                label="Running",
                started_at=hour_start + timedelta(minutes=cursor * 0.6),
                ended_at=visible_end,
            )
        )
    if fill_pct < 100:
        segs.append(
            _seg_payload(
                start_pct=fill_pct,
                end_pct=100.0,
                state="future",
                label="Upcoming",
            )
        )

    # Merge adjacent segments with the same state + coding flag + label
    merged: list[dict[str, Any]] = []
    for seg in segs:
        if (
            merged
            and merged[-1]["state"] == seg["state"]
            and merged[-1].get("label") == seg.get("label")
            and bool(merged[-1].get("needs_reason")) == bool(seg.get("needs_reason"))
            and seg["start_pct"] <= merged[-1]["end_pct"] + 0.75
        ):
            merged[-1]["end_pct"] = max(merged[-1]["end_pct"], seg["end_pct"])
            if seg.get("ended_at"):
                merged[-1]["ended_at"] = seg["ended_at"]
        else:
            merged.append(dict(seg))

    live_state = "running"
    for ev in relevant:
        if ev["started_at"] <= now <= ev["ended_at"]:
            live_state = ev["state"]
            break
    return merged, markers, live_state


def build_station_board(
    db: Session,
    machine_id: int,
    *,
    date: str | None = None,
    shift: str | None = None,
) -> dict[str, Any] | None:
    machine = db.scalar(
        select(Machine).options(joinedload(Machine.production_line)).where(Machine.id == machine_id)
    )
    if not machine:
        return None

    tz = _factory_tz()
    now = datetime.now(tz)
    # Calendar day to review (defaults to today in factory TZ). Cap to today — no future days.
    today_str = now.strftime("%Y-%m-%d")
    if date and date > today_str:
        date = today_str
    if date and date < (now - timedelta(days=14)).strftime("%Y-%m-%d"):
        date = (now - timedelta(days=14)).strftime("%Y-%m-%d")

    # Anchor date for shift windows. Night after midnight still uses the start calendar day.
    if date:
        today = date
    else:
        # If currently in overnight night shift before 06:00, default date is yesterday (shift start day)
        active = _active_shift_for(now)
        if active["key"] == "night" and now.hour < int(active["end_hour"]):
            today = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            today = today_str

    available = _available_shifts_for(today, now)
    if not available:
        # Should not happen for today/past; fall back to day
        available = [_shift_availability(SHIFTS[0], date_str=today, now=now)]
        available[0]["available"] = True

    if shift and any(a["key"] == shift for a in available):
        shift_def = _shift_by_key(shift)
    elif not date or today == today_str:
        # Prefer the live shift when browsing today; else latest completed
        live = next((a for a in available if a["state"] == "live"), None)
        shift_def = _shift_by_key((live or available[-1])["key"])
    else:
        # Past day: default to Day (first available)
        shift_def = _shift_by_key(available[0]["key"])

    shift_start, shift_end = _shift_window_for(shift_def, now=now, date_str=today)
    day_start, day_end = _day_bounds_local(today, tz)

    # Real-time: clamp "progress now" to the selected shift window
    if shift_start <= now <= shift_end:
        view_now = now
    elif now > shift_end or today < today_str:
        # Completed shift (earlier today or a past day) — show full performance
        view_now = shift_end
    else:
        view_now = shift_start

    # DB records (optional enrichment) — cover full shift window (may span 2 calendar days)
    utc_start = shift_start.astimezone(timezone.utc)
    utc_end = shift_end.astimezone(timezone.utc)
    records = list(
        db.scalars(
            select(ProductionRecord)
            .where(
                ProductionRecord.machine_id == machine_id,
                ProductionRecord.recorded_at >= utc_start,
                ProductionRecord.recorded_at < utc_end,
            )
            .order_by(ProductionRecord.recorded_at.asc())
        ).all()
    )
    downtime_db = list(
        db.scalars(
            select(DowntimeEvent)
            .options(joinedload(DowntimeEvent.category))
            .where(
                DowntimeEvent.machine_id == machine_id,
                DowntimeEvent.started_at >= utc_start,
                DowntimeEvent.started_at < utc_end,
            )
            .order_by(DowntimeEvent.started_at.asc())
        )
        .unique()
        .all()
    )

    # Live simulation events for the shift
    sim_events = _simulate_shift_events(
        machine_id,
        today,
        shift_start,
        shift_end,
        shift_key=shift_def["key"],
        break_label=str(shift_def.get("break_label") or "Break"),
    )
    live_events = _clip_events(sim_events, view_now)
    # Prefer coded DB reasons over sim "Uncommented" windows
    live_events = _apply_coded_reasons(live_events, downtime_db, tz)

    # Merge additional labeled DB downtime that does not overlap sim majors
    for d in downtime_db:
        started = _as_utc(d.started_at)
        ended = _as_utc(d.ended_at) or view_now.astimezone(timezone.utc)
        if not started:
            continue
        local_s = started.astimezone(tz)
        local_e = ended.astimezone(tz)
        if local_e <= shift_start or local_s >= shift_end:
            continue
        clip_s = max(local_s, shift_start)
        clip_e = min(local_e, view_now, shift_end)
        if clip_e <= clip_s:
            continue
        # Skip if this window already coded onto a sim event
        if any(
            _overlaps(clip_s, clip_e, ev["started_at"], ev["ended_at"])
            and not ev.get("needs_reason")
            and (ev.get("label") or "").lower() != "uncommented"
            for ev in live_events
            if ev["state"] not in {"running", "slow", "idle", "future"}
        ):
            continue
        live_events.append(
            {
                "started_at": clip_s,
                "ended_at": clip_e,
                "state": _classify_db(d),
                "label": d.reason or (d.category.category_name if d.category else "Downtime"),
                "needs_reason": False,
                "marker": "alert",
            }
        )
    live_events.sort(key=lambda e: e["started_at"])

    work_orders = list(
        db.scalars(
            select(WorkOrder)
            .options(joinedload(WorkOrder.product))
            .where(WorkOrder.machine_id == machine_id)
            .order_by(WorkOrder.id.desc())
            .limit(8)
        )
        .unique()
        .all()
    )
    current_wo = next((wo for wo in work_orders if wo.status == "In Progress"), work_orders[0] if work_orders else None)
    previous_wos = [wo for wo in work_orders if not current_wo or wo.id != current_wo.id][:4]

    plant_profile = profile_for_machine(machine_id, machine.machine_code)
    product_info = plant_profile["product"]
    machine_info = plant_profile["machine"]
    hourly_target = int(plant_profile["hourly_target"])
    run_rate = float(plant_profile["run_rate_per_min"])
    ideal = float(plant_profile["cycle_seconds"])
    planned = float(plant_profile["planned_shift"])

    # Progress through shift for expected output
    shift_seconds = (shift_end - shift_start).total_seconds()
    elapsed = max((view_now - shift_start).total_seconds(), 0)
    progress = min(elapsed / shift_seconds, 1.0) if shift_seconds else 0

    rng = _rng_for(machine_id, today, shift_def["key"])
    # Simulated cumulative output from running / slow time at product rate
    running_seconds = sum(
        (ev["ended_at"] - ev["started_at"]).total_seconds()
        for ev in live_events
        if ev["state"] == "running"
    )
    slow_seconds = sum(
        (ev["ended_at"] - ev["started_at"]).total_seconds()
        for ev in live_events
        if ev["state"] in {"slow"}
    )
    ideal_rate = run_rate
    sim_total = (running_seconds / 60.0) * ideal_rate + (
        slow_seconds / 60.0
    ) * ideal_rate * SLOW_RATE_FACTOR
    # Prefer sim total so old demo DB records do not distort accessory counts
    total = int(round(sim_total))

    good = round(total * rng.uniform(0.96, 0.995), 1)
    rejected = max(round(total - good, 1), 0)
    # Planned production time excludes structured losses (startup / break / wind-down)
    structure_kinds = {"Shift start / handover", "Shift end / cleanup"}
    structure_seconds = sum(
        (min(ev["ended_at"], view_now) - max(ev["started_at"], shift_start)).total_seconds()
        for ev in live_events
        if ev["started_at"] < view_now
        and (
            ev["state"] in {"break", "planned", "structure"}
            and (
                ev.get("label") in structure_kinds
                or ev.get("label") == shift_def.get("break_label")
                or "Break" in (ev.get("label") or "")
                or "Lunch" in (ev.get("label") or "")
                or "handover" in (ev.get("label") or "").lower()
                or "cleanup" in (ev.get("label") or "").lower()
            )
        )
    )
    structure_seconds = max(structure_seconds, 0)
    # Unplanned / fault / idle / setup count against availability
    downtime_seconds = sum(
        (min(ev["ended_at"], view_now) - max(ev["started_at"], shift_start)).total_seconds()
        for ev in live_events
        if ev["started_at"] < view_now
        and ev["state"] not in {"running", "slow", "break", "planned", "structure", "future"}
    )
    planned_seconds = max(elapsed - structure_seconds, 60)
    operating = max(planned_seconds - downtime_seconds, 0)
    avail = kpi_svc.availability(operating, planned_seconds)
    perf = kpi_svc.performance(ideal, total, operating) if total else None
    qual = kpi_svc.quality(good, total) if total else None
    oee = kpi_svc.oee(avail, perf, qual)
    run_minutes = operating / 60

    live_state = _current_state(live_events, view_now)
    status_map = {
        "running": "Running",
        "slow": "Idle",
        "idle": "Idle",
        "setup": "Setup",
        "break": "Planned Stop",
        "planned": "Planned Stop",
        "structure": "Planned Stop",
        "fault": "Fault",
        "unplanned": "Unplanned Stop",
        "nodata": "Offline",
    }

    # Speed series: 1-minute resolution from shift start → now
    speed_series: list[dict[str, Any]] = []
    cursor = shift_start
    while cursor <= view_now:
        active = next((ev for ev in live_events if ev["started_at"] <= cursor < ev["ended_at"]), None)
        state = active["state"] if active else "running"
        if state == "running":
            pcs = ideal_rate * rng.uniform(0.92, 1.08)
        elif state == "slow":
            pcs = ideal_rate * rng.uniform(0.25, 0.55)
        else:
            pcs = 0.0
        speed_series.append(
            {
                "time": cursor.strftime("%H:%M"),
                "pcs_per_min": round(pcs, 2),
                "oee": round((oee or 0) * rng.uniform(0.9, 1.05), 2) if oee else None,
            }
        )
        cursor += timedelta(minutes=2)
    # keep chart readable
    if len(speed_series) > 180:
        step = len(speed_series) // 120
        speed_series = speed_series[:: max(step, 1)]

    hour_starts = _shift_hour_starts(shift_start, shift_end)
    hour_rows = []
    oee_trend = []
    # Cumulative target vs actual pace (shift start → now → end-of-shift plan)
    output_pace: list[dict[str, Any]] = [
        {
            "label": shift_start.strftime("%H:%M"),
            "hour": shift_start.hour,
            "at": shift_start.isoformat(),
            "expected": 0,
            "actual": 0,
            "gap": 0,
        }
    ]
    cum_actual = 0
    for idx, h_start in enumerate(hour_starts):
        h_end = min(h_start + timedelta(hours=1), shift_end)
        hour = h_start.hour
        segs, markers, _ = _hour_segments(live_events, h_start, h_end, view_now)

        # Accessories produced in this hour from running / slow time so far
        hour_run = 0.0
        hour_slow = 0.0
        for ev in live_events:
            a = max(ev["started_at"], h_start)
            b = min(ev["ended_at"], min(h_end, view_now))
            if b <= a:
                continue
            secs = (b - a).total_seconds()
            if ev["state"] == "running":
                hour_run += secs
            elif ev["state"] == "slow":
                hour_slow += secs
        units = (hour_run / 60.0) * run_rate + (hour_slow / 60.0) * run_rate * SLOW_RATE_FACTOR
        if h_start >= view_now:
            units = 0
        actual_h = int(round(units))
        target_h = hourly_target

        # cycle ticks proportional to pieces made this hour
        dots = []
        n_dots = int(min(max(actual_h / max(hourly_target / 40, 1), 0), 48))
        if n_dots:
            positions = sorted(rng.sample(range(1000), min(n_dots, 1000)))
            fill = min((min(h_end, view_now) - h_start).total_seconds() / 3600 * 100, 100)
            dots = [round(p / 1000 * fill, 2) for p in positions]

        hour_rows.append(
            {
                "hour": hour,
                "label": f"{hour:02d}",
                "segments": segs,
                "markers": markers,
                "cycle_dots": dots,
                "actual": actual_h,
                "target": target_h,
                "on_target": actual_h >= int(target_h * 0.85) if target_h and h_start < view_now else True,
            }
        )

        hours_from_start = idx + 1
        if h_start >= view_now:
            oee_trend.append(
                {"hour": hour, "availability": None, "performance": None, "quality": None, "output": 0}
            )
            expected_end = int(hourly_target * hours_from_start)
            output_pace.append(
                {
                    "label": h_end.strftime("%H:%M"),
                    "hour": h_end.hour,
                    "at": h_end.isoformat(),
                    "expected": expected_end,
                    "actual": None,
                    "gap": None,
                }
            )
        else:
            factor = 1.0 if actual_h >= target_h * 0.85 else 0.86
            oee_trend.append(
                {
                    "hour": hour,
                    "availability": round((avail or 0) * factor * rng.uniform(0.96, 1.02), 2) if avail else None,
                    "performance": round((perf or 0) * factor * rng.uniform(0.95, 1.03), 2) if perf else None,
                    "quality": round((qual or 0) * rng.uniform(0.99, 1.0), 2) if qual else None,
                    "output": actual_h,
                }
            )
            cum_actual += actual_h
            elapsed_in_shift = (min(h_end, view_now) - shift_start).total_seconds() / 3600.0
            expected_now = int(round(hourly_target * elapsed_in_shift))
            point_end = min(h_end, view_now)
            output_pace.append(
                {
                    "label": point_end.strftime("%H:%M"),
                    "hour": point_end.hour,
                    "at": point_end.isoformat(),
                    "expected": expected_now,
                    "actual": cum_actual,
                    "gap": cum_actual - expected_now,
                }
            )

    shift_info = _shift_public(shift_def, shift_start, shift_end, date_str=today, now=now)
    return {
        "date": today,
        "live": shift_start <= now <= shift_end,
        "clock": now.isoformat(),
        "shift_label": f"{shift_start.strftime('%A')} {shift_start.strftime('%d.%m')} · {shift_info['label']}",
        "shift": shift_info,
        "plant": PLANT,
        "machine": {
            "id": machine.id,
            "machine_code": machine_info["code"],
            "machine_name": machine_info["name"],
            "machine_type": machine_info["type"],
            "line_name": machine_info["line"],
            "image_url": machine_info["image"],
            "status": status_map.get(live_state, machine.status),
            "status_source": "simulated",
            "last_update_at": now.isoformat(),
        },
        "quantity": {
            "actual": total,
            "planned": int(round(planned)),
            "unit": product_info["unit"],
            "shift_progress_pct": round(progress * 100, 1),
            "hourly_target": hourly_target,
            "run_rate_per_min": round(run_rate, 3),
            "slow_rate_factor": SLOW_RATE_FACTOR,
            "ideal_cycle_seconds": ideal,
        },
        "current_batch": {
            "order_number": current_wo.order_number if current_wo else f"WO-TNU-{machine_id:03d}",
            "product_code": product_info["code"],
            "product_name": product_info["name"],
            "product_image": product_info["image"],
            "actual_quantity": total,
            "planned_quantity": int(round(planned)),
            "progress_pct": round(min(total / planned * 100, 100), 1) if planned else None,
        }
        if current_wo or total
        else None,
        "previous_batches": [
            {
                "order_number": wo.order_number,
                "product_name": wo.product.product_name if wo.product else None,
                "product_code": wo.product.product_code if wo.product else None,
                "actual_quantity": wo.actual_quantity,
                "planned_quantity": wo.planned_quantity,
                "status": wo.status,
            }
            for wo in previous_wos
        ],
        "kpis": {
            "oee": oee,
            "availability": avail,
            "performance": perf,
            "quality": qual,
            "run_time_label": f"{int(run_minutes // 60)}h {int(run_minutes % 60)}m",
            "ideal_cycle_seconds": ideal,
            "structure_loss_minutes": round(structure_seconds / 60.0, 1),
            "planned_net_minutes": round(planned_seconds / 60.0, 1),
        },
        "shift_structure": {
            "startup_label": "Shift start / handover (~10 min)",
            "break_label": shift_def.get("break_label", "Break"),
            "break_range_minutes": [10, 30],
            "winddown_label": "Shift end / cleanup (~10 min)",
            "note": "OEE planned time excludes startup, mid-shift break, and end-of-shift wind-down.",
        },
        "speed_series": speed_series,
        "oee_trend": oee_trend,
        "output_pace": output_pace,
        "pace": {
            "expected_now": next(
                (p["expected"] for p in reversed(output_pace) if p.get("actual") is not None),
                0,
            ),
            "actual_now": cum_actual,
            "gap": cum_actual
            - next((p["expected"] for p in reversed(output_pace) if p.get("actual") is not None), 0),
            "hourly_target": hourly_target,
            "unit": product_info["unit"],
        },
        "hour_rows": hour_rows,
        "downtime": [
            {
                "started_at": ev["started_at"].isoformat(),
                "ended_at": ev["ended_at"].isoformat(),
                "reason": ev["label"],
                "state": ev["state"],
                "duration_minutes": round((ev["ended_at"] - ev["started_at"]).total_seconds() / 60, 1),
            }
            for ev in live_events
            if ev["state"] not in {"running", "slow"}
        ][-12:],
        "events": [],
        "demo_mode": True,
    }
