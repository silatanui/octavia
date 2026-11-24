"""Tanui Plastic Plant catalog — outdoor plastic accessories demo."""

from __future__ import annotations

from typing import Any

PLANT = {
    "site_name": "Tanui Plastic Plant",
    "location": "Injection molding · Outdoor accessories",
    "timezone": "Africa/Nairobi",
    "exterior_image": "/plant/plant-exterior.jpg",
    "tagline": "Outdoor plastic accessories · Injection molding",
}

PRODUCTS: list[dict[str, Any]] = [
    {
        "code": "STO-240",
        "name": "Garden Storage Box 240L",
        "image": "/plant/product-storage-box.jpg",
        "hourly_target": 48,
        "cycle_seconds": 75,
        "unit": "pcs",
    },
    {
        "code": "CHR-01",
        "name": "Outdoor Garden Chair",
        "image": "/plant/product-garden-chair.jpg",
        "hourly_target": 36,
        "cycle_seconds": 100,
        "unit": "pcs",
    },
    {
        "code": "PLN-35",
        "name": "Ribbed Planter 35cm",
        "image": "/plant/product-planter.jpg",
        "hourly_target": 90,
        "cycle_seconds": 40,
        "unit": "pcs",
    },
    {
        "code": "CAB-XL",
        "name": "Outdoor Utility Cabinet",
        "image": "/plant/product-cabinet.jpg",
        "hourly_target": 24,
        "cycle_seconds": 150,
        "unit": "pcs",
    },
    {
        "code": "SHF-5T",
        "name": "Modular Shelf 5-Tier",
        "image": "/plant/product-shelf.jpg",
        "hourly_target": 30,
        "cycle_seconds": 120,
        "unit": "pcs",
    },
]

MACHINES: list[dict[str, Any]] = [
    {
        "code": "IMM-01",
        "name": "Engel Duo 700",
        "type": "Injection Press",
        "line": "Molding Hall A",
        "image": "/plant/imm-press.jpg",
        "product_code": "STO-240",
    },
    {
        "code": "IMM-02",
        "name": "Engel Victory 500",
        "type": "Injection Press",
        "line": "Molding Hall A",
        "image": "/plant/imm-press-b.jpg",
        "product_code": "CHR-01",
    },
    {
        "code": "IMM-03",
        "name": "KraussMaffei CX 350",
        "type": "Injection Press",
        "line": "Molding Hall A",
        "image": "/plant/imm-press.jpg",
        "product_code": "PLN-35",
    },
    {
        "code": "IMM-04",
        "name": "Engel Duo 1100",
        "type": "Injection Press",
        "line": "Molding Hall B",
        "image": "/plant/imm-press-b.jpg",
        "product_code": "CAB-XL",
    },
    {
        "code": "IMM-05",
        "name": "Husky HyPET 300",
        "type": "Injection Press",
        "line": "Molding Hall B",
        "image": "/plant/imm-press.jpg",
        "product_code": "SHF-5T",
    },
    {
        "code": "IMM-06",
        "name": "Engel Victory 280",
        "type": "Injection Press",
        "line": "Molding Hall B",
        "image": "/plant/imm-press-b.jpg",
        "product_code": "PLN-35",
    },
    {
        "code": "ASM-01",
        "name": "Assembly Cell North",
        "type": "Assembly",
        "line": "Finishing",
        "image": "/plant/imm-press.jpg",
        "product_code": "STO-240",
    },
    {
        "code": "ASM-02",
        "name": "Assembly Cell South",
        "type": "Assembly",
        "line": "Finishing",
        "image": "/plant/imm-press-b.jpg",
        "product_code": "CAB-XL",
    },
]


def product_by_code(code: str | None) -> dict[str, Any]:
    for p in PRODUCTS:
        if p["code"] == code:
            return p
    return PRODUCTS[0]


def machine_profile(machine_id: int, machine_code: str | None = None) -> dict[str, Any]:
    if machine_code:
        for m in MACHINES:
            if m["code"] == machine_code:
                return m
    idx = max(0, (machine_id - 1) % len(MACHINES))
    return MACHINES[idx]


def profile_for_machine(machine_id: int, machine_code: str | None = None) -> dict[str, Any]:
    m = machine_profile(machine_id, machine_code)
    p = product_by_code(m["product_code"])
    return {
        "machine": m,
        "product": p,
        "hourly_target": int(p["hourly_target"]),
        "run_rate_per_min": float(p["hourly_target"]) / 60.0,
        "cycle_seconds": float(p["cycle_seconds"]),
        "planned_shift": int(p["hourly_target"]) * 8,
    }
