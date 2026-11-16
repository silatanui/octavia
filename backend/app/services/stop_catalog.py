"""Plastics-plant stop-reason catalog (Evocon-style groups → reasons)."""

from __future__ import annotations

from typing import Any

# Stop groups map to DowntimeCategory.category_name (created on demand).
STOP_GROUPS: list[dict[str, Any]] = [
    {
        "key": "technical",
        "name": "Technical",
        "planned_or_unplanned": "unplanned",
        "color": "#c2410c",
        "reasons": [
            "Heater fault",
            "Hydraulic issue",
            "Machine reset",
            "Electrical failure",
            "Mechanical failure",
            "Conveyor breakdown",
            "Cooling failure",
            "Sensor / safety trip",
        ],
    },
    {
        "key": "setup",
        "name": "Setup",
        "planned_or_unplanned": "planned",
        "color": "#1d4f91",
        "reasons": [
            "Tool change",
            "Colour changeover",
            "Product changeover",
            "Mould change",
            "Set up",
            "First-off approval",
        ],
    },
    {
        "key": "maintenance",
        "name": "Maintenance",
        "planned_or_unplanned": "planned",
        "color": "#9a3412",
        "reasons": [
            "Planned cleaning",
            "Unplanned cleaning",
            "Unplanned maintenance",
            "Scheduled PM",
            "Hopper clean",
            "Mould cleaning",
        ],
    },
    {
        "key": "organisational",
        "name": "Organisational",
        "planned_or_unplanned": "unplanned",
        "color": "#0f766e",
        "reasons": [
            "Operator missing",
            "Shift handover",
            "Meeting",
            "Work on another machine",
            "No planned production",
            "Lunch",
            "Break",
        ],
    },
    {
        "key": "material",
        "name": "Material",
        "planned_or_unplanned": "unplanned",
        "color": "#15803d",
        "reasons": [
            "Material shortage",
            "Material quality issues",
            "Supplies missing",
            "Forklift wait",
            "Resin change",
            "Waiting for blanks",
        ],
    },
    {
        "key": "quality",
        "name": "Quality",
        "planned_or_unplanned": "unplanned",
        "color": "#a16207",
        "reasons": [
            "Quality hold",
            "Dimensional check",
            "Scrap purge",
            "First article reject",
        ],
    },
]

MOST_USED = [
    "Unplanned cleaning",
    "Product changeover",
    "Shift handover",
    "Operator missing",
    "Unplanned maintenance",
    "Material shortage",
    "Machine reset",
]


def catalog_payload() -> dict[str, Any]:
    return {
        "most_used": MOST_USED,
        "groups": [
            {
                "key": g["key"],
                "name": g["name"],
                "planned_or_unplanned": g["planned_or_unplanned"],
                "color": g["color"],
                "reasons": list(g["reasons"]),
            }
            for g in STOP_GROUPS
        ],
    }


def find_group_for_reason(reason: str) -> dict[str, Any] | None:
    needle = (reason or "").strip().lower()
    if not needle:
        return None
    for g in STOP_GROUPS:
        for r in g["reasons"]:
            if r.lower() == needle:
                return g
    # fuzzy contains
    for g in STOP_GROUPS:
        for r in g["reasons"]:
            if needle in r.lower() or r.lower() in needle:
                return g
    return None


def reason_color(reason: str | None) -> str:
    g = find_group_for_reason(reason or "")
    if g:
        return str(g["color"])
    if (reason or "").strip().lower() in {"uncommented", "unclassified", ""}:
        return "#b91c1c"
    return "#64748b"
