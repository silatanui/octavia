"""Data-backed daily production insights.

Observations are derived only from recorded KPIs, production counts,
downtime and cycle metrics. Causes are not invented beyond what the
records show (e.g. named downtime reasons).
"""

from __future__ import annotations

from typing import Any


def _pp(curr: float | None, prev: float | None) -> float | None:
    if curr is None or prev is None:
        return None
    return round(curr - prev, 2)


def _fmt_pp(value: float | None) -> str:
    if value is None:
        return "—"
    sign = "+" if value > 0 else ""
    return f"{sign}{value:.0f}pp" if abs(value) >= 1 else f"{sign}{value:.2f}pp"


def _hours(minutes: float) -> str:
    return f"{minutes / 60:.1f}h"


def build_ai_summary(dashboard: dict[str, Any]) -> dict[str, Any]:
    kpis = dashboard.get("kpis") or {}
    machines: list[dict[str, Any]] = dashboard.get("machines") or []
    goal = float(kpis.get("utilization_goal") or 60)

    issues: list[dict[str, Any]] = []
    highlights: list[dict[str, Any]] = []
    standards: list[dict[str, Any]] = []
    recommendations: list[dict[str, Any]] = []

    oee = kpis.get("oee")
    # Previous OEE not stored directly — approximate from availability delta context
    prev_avail = kpis.get("previous_availability")
    avail = kpis.get("availability")
    ach = kpis.get("achievement")
    prev_ach = kpis.get("previous_achievement")
    actual = float(kpis.get("actual_production") or 0)
    prev_actual = float(kpis.get("previous_production") or 0)
    dt_min = float(kpis.get("total_downtime_minutes") or 0)

    # ---- Plant-level executive narrative from recorded KPIs ----
    narrative_bits: list[str] = []
    if oee is not None and avail is not None:
        narrative_bits.append(
            f"Plant OEE is {oee:.1f}% with utilization/availability at {avail:.1f}%."
        )
    if ach is not None:
        delta_ach = _pp(ach, prev_ach)
        if delta_ach is not None:
            narrative_bits.append(
                f"Parts goal achievement is {ach:.1f}% ({_fmt_pp(delta_ach)} vs prior day)."
            )
        else:
            narrative_bits.append(f"Parts goal achievement is {ach:.1f}%.")
    if actual or prev_actual:
        delta_parts = actual - prev_actual
        sign = "+" if delta_parts >= 0 else ""
        narrative_bits.append(
            f"Total parts {actual:,.0f} ({sign}{delta_parts:,.0f} vs prior day)."
        )
    if dt_min:
        narrative_bits.append(f"Recorded downtime totals {_hours(dt_min)}.")

    # Top movers by OEE / utilization
    with_oee = [m for m in machines if m.get("oee") is not None]
    if with_oee:
        best = max(with_oee, key=lambda m: m["oee"])
        worst = min(with_oee, key=lambda m: m["oee"])
        narrative_bits.append(
            f"Highest OEE: {best['machine_code']} at {best['oee']:.1f}%; "
            f"lowest: {worst['machine_code']} at {worst['oee']:.1f}%."
        )

    executive = " ".join(narrative_bits) or "Insufficient recorded data to summarize this period."

    # ---- Issues ----
    low_util = [
        m
        for m in machines
        if m.get("utilization") is not None and m["utilization"] < goal
    ]
    for m in sorted(low_util, key=lambda x: x["utilization"])[:6]:
        reasons = m.get("downtime_reasons") or []
        reason_txt = ""
        if reasons:
            top = reasons[0]
            reason_txt = f" Top recorded reason: {top['reason']} ({top['hours_label']})."
        gap = goal - (m["utilization"] or 0)
        issues.append(
            {
                "category": "AVAILABILITY",
                "title": f"{gap:.0f}pp below utilization goal on {m['machine_code']}",
                "detail": (
                    f"{m['machine_name']} utilization {m['utilization']:.1f}% vs goal {goal:.1f}%. "
                    f"Downtime {_hours(m.get('downtime_minutes') or 0)}."
                    f"{reason_txt}"
                ),
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "high" if (m["utilization"] or 0) < goal * 0.5 else "medium",
            }
        )

    slow_cycle = [
        m
        for m in machines
        if m.get("cycle_delta_seconds") is not None and m["cycle_delta_seconds"] > 0
    ]
    for m in sorted(slow_cycle, key=lambda x: -(x["cycle_delta_seconds"] or 0))[:4]:
        issues.append(
            {
                "category": "PERFORMANCE",
                "title": f"Cycle time above ideal on {m['machine_code']}",
                "detail": (
                    f"{m['cycle_label']} (+{m['cycle_delta_seconds']:.1f}s vs ideal "
                    f"{m.get('ideal_cycle_seconds', 0):.0f}s). Output {m.get('output', 0):.0f} units."
                ),
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "medium",
            }
        )

    zero_output = [m for m in machines if (m.get("output") or 0) == 0 and m.get("status") != "Offline"]
    if zero_output:
        codes = [m["machine_code"] for m in zero_output]
        issues.append(
            {
                "category": "INTEGRITY",
                "title": f"{len(zero_output)} machine(s) with zero recorded output",
                "detail": (
                    f"No production records for: {', '.join(codes)}. "
                    "Confirm counting source or enter manual counts."
                ),
                "machine_ids": [m["id"] for m in zero_output],
                "machine_codes": codes,
                "severity": "high",
            }
        )

    faulted = [m for m in machines if m.get("status") in {"Fault", "Unplanned Stop"}]
    for m in faulted:
        reasons = m.get("downtime_reasons") or []
        reason = reasons[0]["reason"] if reasons else m["status"]
        issues.append(
            {
                "category": "AVAILABILITY",
                "title": f"{m['machine_code']} in {m['status']} state",
                "detail": f"Current status {m['status']}. Recorded stop reason: {reason}.",
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "critical",
            }
        )

    behind = [
        m
        for m in machines
        if m.get("achievement") is not None and m["achievement"] < 70 and (m.get("target") or 0) > 0
    ]
    for m in behind[:4]:
        issues.append(
            {
                "category": "PERFORMANCE",
                "title": f"Behind parts target on {m['machine_code']}",
                "detail": (
                    f"Achievement {m['achievement']:.1f}% "
                    f"({m.get('output', 0):.0f} / {m.get('target', 0):.0f})."
                ),
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "medium",
            }
        )

    # ---- Highlights ----
    strong_util = [
        m for m in machines if m.get("utilization") is not None and m["utilization"] >= goal
    ]
    for m in sorted(strong_util, key=lambda x: -(x["utilization"] or 0))[:4]:
        highlights.append(
            {
                "category": "AVAILABILITY",
                "title": f"{m['machine_code']} at or above utilization goal",
                "detail": f"Utilization {m['utilization']:.1f}% vs goal {goal:.1f}%. OEE {m.get('oee') or 0:.1f}%.",
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "info",
            }
        )

    gainers = [
        m
        for m in machines
        if (m.get("output") or 0) > (m.get("previous_output") or 0)
    ]
    for m in sorted(gainers, key=lambda x: -((x.get("output") or 0) - (x.get("previous_output") or 0)))[:4]:
        delta = (m.get("output") or 0) - (m.get("previous_output") or 0)
        highlights.append(
            {
                "category": "PERFORMANCE",
                "title": f"Output up on {m['machine_code']}",
                "detail": f"{m.get('output', 0):.0f} parts (+{delta:.0f} vs prior day).",
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "info",
            }
        )

    fast_cycle = [
        m
        for m in machines
        if m.get("cycle_delta_seconds") is not None and m["cycle_delta_seconds"] <= 0 and (m.get("output") or 0) > 0
    ]
    for m in sorted(fast_cycle, key=lambda x: x["cycle_delta_seconds"] or 0)[:3]:
        highlights.append(
            {
                "category": "PERFORMANCE",
                "title": f"Cycle at or under ideal on {m['machine_code']}",
                "detail": m.get("cycle_label") or "",
                "machine_ids": [m["id"]],
                "machine_codes": [m["machine_code"]],
                "severity": "info",
            }
        )

    if kpis.get("production_delta") and float(kpis["production_delta"]) > 0:
        highlights.append(
            {
                "category": "PERFORMANCE",
                "title": "Plant output increased vs prior day",
                "detail": (
                    f"Total parts {actual:,.0f} "
                    f"(+{float(kpis['production_delta']):,.0f})."
                ),
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            }
        )

    # ---- Standards (thresholds / definitions in use) ----
    standards.extend(
        [
            {
                "category": "STANDARD",
                "title": "Utilization goal",
                "detail": f"Machines are flagged when utilization is below {goal:.0f}%.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            },
            {
                "category": "STANDARD",
                "title": "OEE definition",
                "detail": "OEE = Availability × Performance × Quality from recorded operating time, counts and rejects.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            },
            {
                "category": "STANDARD",
                "title": "Cycle time comparison",
                "detail": "Actual cycle estimated as operating time ÷ total units; compared to product ideal cycle time.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            },
            {
                "category": "STANDARD",
                "title": "Comparison period",
                "detail": f"Deltas compare {dashboard.get('date_label')} with prior day {dashboard.get('compare_label')}.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            },
            {
                "category": "STANDARD",
                "title": "Evidence rule",
                "detail": "Insights cite only recorded production, downtime reasons and machine status — no unverified root causes.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            },
        ]
    )

    # ---- Recommendations tied to evidence ----
    if faulted:
        codes = [m["machine_code"] for m in faulted]
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Clear open faults before end of shift",
                "detail": f"Escalate maintenance for: {', '.join(codes)}. Status is Fault/Unplanned Stop in the live board.",
                "machine_ids": [m["id"] for m in faulted],
                "machine_codes": codes,
                "severity": "high",
            }
        )

    waiting = [
        m
        for m in machines
        if any("waiting" in (r.get("reason") or "").lower() for r in (m.get("downtime_reasons") or []))
    ]
    if waiting:
        codes = [m["machine_code"] for m in waiting]
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Review material / work queue for waiting machines",
                "detail": (
                    f"Recorded 'Waiting for Work' (or similar) on {', '.join(codes)}. "
                    "Confirm upstream supply and job release."
                ),
                "machine_ids": [m["id"] for m in waiting],
                "machine_codes": codes,
                "severity": "medium",
            }
        )

    if slow_cycle:
        codes = [m["machine_code"] for m in slow_cycle[:5]]
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Investigate slow cycle vs ideal",
                "detail": (
                    f"Cycle above ideal on {', '.join(codes)}. "
                    "Compare tool condition, feeds/speeds and setup notes against the product standard."
                ),
                "machine_ids": [m["id"] for m in slow_cycle[:5]],
                "machine_codes": codes,
                "severity": "medium",
            }
        )

    if zero_output:
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Validate production counting",
                "detail": (
                    "Enter manual production records or verify machine event sources for machines with zero output."
                ),
                "machine_ids": [m["id"] for m in zero_output],
                "machine_codes": [m["machine_code"] for m in zero_output],
                "severity": "medium",
            }
        )

    setup_heavy = [
        m
        for m in machines
        if any(
            (r.get("reason") or "").lower() in {"setup", "changeover"}
            or "setup" in (r.get("reason") or "").lower()
            for r in (m.get("downtime_reasons") or [])
        )
    ]
    if setup_heavy:
        codes = [m["machine_code"] for m in setup_heavy]
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Reduce setup / changeover loss",
                "detail": f"Setup-related downtime recorded on {', '.join(codes)}. Review changeover checklist and tooling readiness.",
                "machine_ids": [m["id"] for m in setup_heavy],
                "machine_codes": codes,
                "severity": "medium",
            }
        )

    if not recommendations:
        recommendations.append(
            {
                "category": "ACTION",
                "title": "Maintain current control rhythm",
                "detail": "No critical gaps detected from recorded data. Continue hourly board reviews and downtime coding.",
                "machine_ids": [],
                "machine_codes": [],
                "severity": "info",
            }
        )

    return {
        "generated_at": dashboard.get("last_updated"),
        "demo_mode": dashboard.get("demo_mode", False),
        "source": "rules_engine",
        "disclaimer": "Summary is generated from recorded Octavia data only; it does not invent unverified root causes.",
        "executive_summary": executive,
        "tabs": {
            "issues": issues,
            "highlights": highlights,
            "standards": standards,
            "recommendations": recommendations,
        },
        "counts": {
            "issues": len(issues),
            "highlights": len(highlights),
            "standards": len(standards),
            "recommendations": len(recommendations),
        },
    }
