"""Typical plant shift structure: startup wait, mid-shift break, end-of-shift wind-down.

These are *planned* non-production windows (not faults). OEE planned production
time should exclude them; the station Gantt should show them as break/planned.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any


# Defaults match common shop-floor practice (minutes)
STARTUP_MIN_DEFAULT = (8, 14)  # ~10 min average before productive work
BREAK_MIN_DEFAULT = (10, 30)  # mid-shift break / lunch
WINDDOWN_MIN_DEFAULT = (8, 15)  # wrap-up near shift end
# Two 8h shifts / day used for plant-wide analysis
ANALYSIS_SHIFTS_PER_DAY = 2
ANALYSIS_SHIFT_HOURS = 8


@dataclass(frozen=True)
class ShiftLossWindow:
    start: datetime
    end: datetime
    kind: str  # startup | break | winddown
    label: str

    @property
    def minutes(self) -> float:
        return max((self.end - self.start).total_seconds() / 60.0, 0.0)


def average_planned_loss_minutes_per_shift(
    *,
    startup_avg: float = 10.0,
    break_avg: float = 20.0,
    winddown_avg: float = 12.0,
) -> float:
    return startup_avg + break_avg + winddown_avg


def net_planned_minutes_per_shift(
    shift_hours: float = ANALYSIS_SHIFT_HOURS,
    *,
    startup_avg: float = 10.0,
    break_avg: float = 20.0,
    winddown_avg: float = 12.0,
) -> float:
    """Planned production time after removing typical structured losses."""
    gross = shift_hours * 60.0
    losses = average_planned_loss_minutes_per_shift(
        startup_avg=startup_avg,
        break_avg=break_avg,
        winddown_avg=winddown_avg,
    )
    return max(gross - losses, 60.0)


def plant_net_planned_minutes(
    *,
    days: int,
    machines: int,
    shifts_per_day: int = ANALYSIS_SHIFTS_PER_DAY,
) -> float:
    per_shift = net_planned_minutes_per_shift()
    return days * shifts_per_day * per_shift * max(machines, 1)


def build_shift_structure_windows(
    shift_start: datetime,
    shift_end: datetime,
    rng: Any,
    *,
    break_label: str = "Break / Lunch",
) -> list[ShiftLossWindow]:
    """Deterministic-ish structure windows for one simulated shift."""
    shift_len = shift_end - shift_start
    if shift_len <= timedelta(minutes=40):
        return []

    windows: list[ShiftLossWindow] = []

    # 1) Startup / handover wait (~10 min avg)
    startup_mins = int(rng.randint(*STARTUP_MIN_DEFAULT))
    startup_end = min(shift_start + timedelta(minutes=startup_mins), shift_end - timedelta(minutes=25))
    if startup_end > shift_start:
        windows.append(
            ShiftLossWindow(
                start=shift_start,
                end=startup_end,
                kind="startup",
                label="Shift start / handover",
            )
        )

    # 2) Mid-shift break (10–30 min), roughly 3–4.5h in, clear of startup/wind-down
    break_mins = int(rng.randint(*BREAK_MIN_DEFAULT))
    earliest_break = shift_start + timedelta(hours=2, minutes=45)
    latest_break = shift_end - timedelta(minutes=break_mins + 25)
    if latest_break > earliest_break:
        span = int((latest_break - earliest_break).total_seconds() // 60)
        break_start = earliest_break + timedelta(minutes=rng.randint(0, max(span, 1)))
        # Keep clear of startup
        if windows and break_start < windows[0].end + timedelta(minutes=15):
            break_start = windows[0].end + timedelta(minutes=15)
        break_end = break_start + timedelta(minutes=break_mins)
        if break_end <= shift_end - timedelta(minutes=20):
            windows.append(
                ShiftLossWindow(
                    start=break_start,
                    end=break_end,
                    kind="break",
                    label=break_label,
                )
            )

    # 3) End-of-shift wind-down / cleanup (~10–12 min avg)
    wind_mins = int(rng.randint(*WINDDOWN_MIN_DEFAULT))
    wind_start = shift_end - timedelta(minutes=wind_mins)
    # Don't overlap mid break
    for w in windows:
        if w.kind == "break" and wind_start < w.end:
            wind_start = w.end + timedelta(minutes=5)
    if wind_start < shift_end and wind_start > shift_start + timedelta(minutes=30):
        windows.append(
            ShiftLossWindow(
                start=wind_start,
                end=shift_end,
                kind="winddown",
                label="Shift end / cleanup",
            )
        )

    windows.sort(key=lambda w: w.start)
    return windows


def structure_as_blocked(
    windows: list[ShiftLossWindow],
) -> list[tuple[datetime, datetime, dict[str, Any]]]:
    """Convert structure windows into station simulator blocked tuples."""
    out: list[tuple[datetime, datetime, dict[str, Any]]] = []
    for w in windows:
        # Startup/wind-down stay slate ("structure"); mid-shift break stays break-blue.
        # Do not use "planned" here — that colour is reserved for issue/stop red after coding.
        if w.kind in {"startup", "winddown"}:
            state = "structure"
        else:
            state = "break"
        out.append(
            (
                w.start,
                w.end,
                {
                    "state": state,
                    "label": w.label,
                    "marker": None,
                    "needs_reason": False,
                    "structure_kind": w.kind,
                },
            )
        )
    return out
