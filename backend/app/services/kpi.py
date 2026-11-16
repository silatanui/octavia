"""KPI calculation helpers.

Formulas (MVP definitions):
- Production achievement = actual / planned * 100
- Availability = operating_time / planned_production_time * 100
- Performance = (ideal_cycle_time * total_units) / operating_time * 100
- Quality = good_units / total_units * 100
- OEE = availability * performance * quality  (decimals multiplied, then * 100)
- Rejection rate = rejected / total * 100
- Downtime duration = end - start
"""

from __future__ import annotations


def pct(numerator: float, denominator: float) -> float | None:
    if denominator is None or denominator <= 0:
        return None
    return round((numerator / denominator) * 100, 2)


def achievement(actual: float, planned: float) -> float | None:
    return pct(actual, planned)


def availability(operating_seconds: float, planned_seconds: float) -> float | None:
    return pct(operating_seconds, planned_seconds)


def performance(ideal_cycle_seconds: float, total_units: float, operating_seconds: float) -> float | None:
    if operating_seconds is None or operating_seconds <= 0:
        return None
    return round((ideal_cycle_seconds * total_units / operating_seconds) * 100, 2)


def quality(good_units: float, total_units: float) -> float | None:
    return pct(good_units, total_units)


def rejection_rate(rejected_units: float, total_units: float) -> float | None:
    return pct(rejected_units, total_units)


def oee(availability_pct: float | None, performance_pct: float | None, quality_pct: float | None) -> float | None:
    if availability_pct is None or performance_pct is None or quality_pct is None:
        return None
    return round((availability_pct / 100) * (performance_pct / 100) * (quality_pct / 100) * 100, 2)


def downtime_minutes(started_at, ended_at) -> float | None:
    if not started_at or not ended_at:
        return None
    # Normalize naive datetimes (MySQL) vs aware UTC bounds
    if getattr(started_at, "tzinfo", None) is None and getattr(ended_at, "tzinfo", None) is not None:
        started_at = started_at.replace(tzinfo=ended_at.tzinfo)
    if getattr(ended_at, "tzinfo", None) is None and getattr(started_at, "tzinfo", None) is not None:
        ended_at = ended_at.replace(tzinfo=started_at.tzinfo)
    return round((ended_at - started_at).total_seconds() / 60, 2)
