"""Create schema and load demo manufacturing data for Octavia MVP."""

from __future__ import annotations

import random
from datetime import date, datetime, timedelta, time, timezone

from sqlalchemy import delete, select

from app.core.database import Base, SessionLocal, engine
from app.core.security import get_password_hash
from app.models import (
    ActionItem,
    Alert,
    Department,
    DowntimeCategory,
    DowntimeEvent,
    Machine,
    MachineEvent,
    Product,
    ProductionLine,
    ProductionRecord,
    QualityRecord,
    Role,
    Shift,
    ShiftNote,
    Site,
    StaffAssignment,
    User,
    WorkOrder,
)

MACHINE_STATES = ["Running", "Idle", "Setup", "Planned Stop", "Unplanned Stop", "Fault", "Offline"]
HISTORY_SOURCE = "history"

# Shift hour windows (local plant clock, stored as UTC-naive-compatible aware stamps)
SHIFT_HOURS = {
    "Day": list(range(6, 14)),
    "Afternoon": list(range(14, 22)),
    "Night": [22, 23, 0, 1, 2, 3, 4, 5],
}

# Weighted downtime reasons from the stop catalog (+ uncommented)
_HISTORY_STOPS: list[tuple[str, str, tuple[int, int]]] = [
    ("Technical", "Heater fault", (15, 55)),
    ("Technical", "Hydraulic issue", (20, 70)),
    ("Technical", "Machine reset", (8, 25)),
    ("Technical", "Electrical failure", (25, 90)),
    ("Technical", "Cooling failure", (18, 50)),
    ("Setup", "Product changeover", (20, 45)),
    ("Setup", "Colour changeover", (15, 40)),
    ("Setup", "Mould change", (25, 60)),
    ("Setup", "Tool change", (18, 40)),
    ("Maintenance", "Scheduled PM", (30, 90)),
    ("Maintenance", "Unplanned cleaning", (12, 35)),
    ("Maintenance", "Unplanned maintenance", (20, 75)),
    ("Maintenance", "Hopper clean", (10, 25)),
    ("Organisational", "Operator missing", (10, 40)),
    ("Organisational", "Shift handover", (8, 20)),
    ("Organisational", "Break", (10, 30)),
    ("Organisational", "Lunch", (20, 35)),
    ("Material", "Material shortage", (15, 55)),
    ("Material", "Resin change", (12, 30)),
    ("Material", "Forklift wait", (8, 22)),
    ("Quality", "Quality hold", (12, 40)),
    ("Quality", "Scrap purge", (10, 28)),
    ("Uncommented", "Uncommented", (8, 20)),
]


def seed_staff_assignments_demo(db) -> None:
    """Ensure today's Day shift has sample line/machine placements (idempotent)."""
    Base.metadata.create_all(bind=engine)
    if db.scalar(select(StaffAssignment).limit(1)):
        return

    users = {u.email: u for u in db.scalars(select(User)).all()}
    shifts = {s.shift_name: s for s in db.scalars(select(Shift)).all()}
    lines = {ln.line_name: ln for ln in db.scalars(select(ProductionLine)).all()}
    machines = list(db.scalars(select(Machine).order_by(Machine.id.asc())).all())
    day = shifts.get("Day") or db.scalars(select(Shift).order_by(Shift.id.asc())).first()
    if not day or not machines:
        return

    today = date.today()
    line_a = lines.get("Molding Hall A") or db.scalars(select(ProductionLine).order_by(ProductionLine.id.asc())).first()
    line_b = lines.get("Molding Hall B")
    supervisor = users.get("supervisor@octavia.local")
    manager = users.get("manager@octavia.local")
    operator = users.get("operator@octavia.local")
    maintenance = users.get("maintenance@octavia.local")

    rows: list[StaffAssignment] = []
    if manager and line_a:
        rows.append(
            StaffAssignment(
                user_id=manager.id,
                work_date=today,
                shift_id=day.id,
                assignment_role="section_lead",
                production_line_id=line_a.id,
                notes="Hall coverage",
                created_by=manager.id,
            )
        )
    if supervisor and line_b:
        rows.append(
            StaffAssignment(
                user_id=supervisor.id,
                work_date=today,
                shift_id=day.id,
                assignment_role="team_lead",
                production_line_id=line_b.id,
                notes="Hall B lead",
                created_by=manager.id if manager else supervisor.id,
            )
        )
    if operator and machines:
        rows.append(
            StaffAssignment(
                user_id=operator.id,
                work_date=today,
                shift_id=day.id,
                assignment_role="operator",
                machine_id=machines[0].id,
                created_by=supervisor.id if supervisor else operator.id,
            )
        )
    if maintenance and len(machines) > 1:
        rows.append(
            StaffAssignment(
                user_id=maintenance.id,
                work_date=today,
                shift_id=day.id,
                assignment_role="relief",
                machine_id=machines[1].id,
                notes="Float / relief",
                created_by=supervisor.id if supervisor else maintenance.id,
            )
        )

    # Extra demo operators if present from a fresh seed
    for email, role, machine_idx in (
        ("junior1@octavia.local", "junior", 2),
        ("op2@octavia.local", "operator", 3),
        ("lead2@octavia.local", "team_lead", None),
    ):
        u = users.get(email)
        if not u:
            continue
        if role in {"team_lead", "section_lead"} and line_a:
            rows.append(
                StaffAssignment(
                    user_id=u.id,
                    work_date=today,
                    shift_id=day.id,
                    assignment_role=role,
                    production_line_id=line_a.id,
                    created_by=supervisor.id if supervisor else u.id,
                )
            )
        elif machine_idx is not None and machine_idx < len(machines):
            rows.append(
                StaffAssignment(
                    user_id=u.id,
                    work_date=today,
                    shift_id=day.id,
                    assignment_role=role,
                    machine_id=machines[machine_idx].id,
                    created_by=supervisor.id if supervisor else u.id,
                )
            )

    if rows:
        db.add_all(rows)
        db.commit()
        print(f"Seeded {len(rows)} staff assignment(s) for {today} / {day.shift_name}.")


def seed_historical_data(days: int = 30, *, replace: bool = True) -> dict[str, int]:
    """Backfill randomized production + downtime for the last N days.

    Fills through end of yesterday only so today's live station simulation keeps running.
    Re-running with replace=True clears prior HISTORY_SOURCE rows in the window first.
    """
    from app.services.plant_catalog import MACHINES as CATALOG_MACHINES, PRODUCTS as CATALOG_PRODUCTS

    days = max(1, min(int(days), 90))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        machines = list(db.scalars(select(Machine).where(Machine.active.is_(True)).order_by(Machine.id.asc())).all())
        shifts = {s.shift_name: s for s in db.scalars(select(Shift)).all()}
        categories = {c.category_name: c for c in db.scalars(select(DowntimeCategory)).all()}
        products = list(db.scalars(select(Product).order_by(Product.id.asc())).all())
        by_code = {p.product_code: p for p in products}
        operator = db.scalar(select(User).where(User.email == "operator@octavia.local"))
        supervisor = db.scalar(select(User).where(User.email == "supervisor@octavia.local"))

        if not machines or not shifts or not products:
            print("Cannot seed history — plant master data missing. Run seed first.")
            return {"production": 0, "downtime": 0, "quality": 0}

        # Ensure stop categories exist
        for cat_name, planned in (
            ("Technical", "unplanned"),
            ("Setup", "planned"),
            ("Maintenance", "planned"),
            ("Organisational", "unplanned"),
            ("Material", "unplanned"),
            ("Quality", "unplanned"),
            ("Break", "planned"),
            ("Uncommented", "unplanned"),
        ):
            if cat_name not in categories:
                cat = DowntimeCategory(category_name=cat_name, planned_or_unplanned=planned)
                db.add(cat)
                db.flush()
                categories[cat_name] = cat

        now = datetime.now(timezone.utc)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        # History ends at yesterday so live sim for "now" is untouched
        end_day = today - timedelta(days=1)
        start_day = today - timedelta(days=days)

        if replace:
            db.execute(
                delete(ProductionRecord).where(
                    ProductionRecord.source == HISTORY_SOURCE,
                    ProductionRecord.recorded_at >= start_day,
                    ProductionRecord.recorded_at < today,
                )
            )
            db.execute(
                delete(DowntimeEvent).where(
                    DowntimeEvent.notes == "Historical demo downtime",
                    DowntimeEvent.started_at >= start_day,
                    DowntimeEvent.started_at < today,
                )
            )
            db.execute(
                delete(QualityRecord).where(
                    QualityRecord.notes == "Historical demo inspection",
                    QualityRecord.inspected_at >= start_day,
                    QualityRecord.inspected_at < today,
                )
            )
            db.commit()

        catalog_by_code = {m["code"]: m for m in CATALOG_MACHINES}
        product_meta = {p["code"]: p for p in CATALOG_PRODUCTS}
        open_wos = {
            wo.machine_id: wo
            for wo in db.scalars(select(WorkOrder).where(WorkOrder.status.in_(["In Progress", "Paused", "Completed"]))).all()
        }

        prod_n = 0
        dt_n = 0
        qa_n = 0
        day_shift = shifts.get("Day")
        afternoon = shifts.get("Afternoon")
        night = shifts.get("Night")
        shift_objs = [("Day", day_shift), ("Afternoon", afternoon), ("Night", night)]

        cursor = start_day
        while cursor <= end_day:
            weekday = cursor.weekday()  # 0=Mon … 6=Sun
            weekend = weekday >= 5
            day_key = cursor.strftime("%Y-%m-%d")

            for m_idx, machine in enumerate(machines):
                rng = random.Random(f"{HISTORY_SOURCE}:{machine.id}:{day_key}")
                spec = catalog_by_code.get(machine.machine_code) or {}
                product_code = spec.get("product_code") or products[m_idx % len(products)].product_code
                product = by_code.get(product_code) or products[m_idx % len(products)]
                meta = product_meta.get(product.product_code) or {}
                hourly_target = int(meta.get("hourly_target") or max(int(3600 / (product.ideal_cycle_time or 60)), 12))
                wo = open_wos.get(machine.id)

                # Machine-level personality: some presses run hotter, some scrapier
                util_bias = 0.72 + (m_idx % 5) * 0.04
                scrap_bias = 0.012 + (m_idx % 4) * 0.006
                if weekend:
                    util_bias *= 0.55
                    # Some machines idle on weekends
                    if rng.random() < 0.35:
                        continue

                for shift_name, shift in shift_objs:
                    if not shift:
                        continue
                    # Night often quieter; skip some weekend nights
                    if shift_name == "Night" and (weekend or rng.random() < 0.2):
                        if rng.random() < 0.55:
                            continue
                    shift_util = util_bias * (0.92 if shift_name == "Day" else 0.85 if shift_name == "Afternoon" else 0.7)
                    # Occasional bad day
                    if rng.random() < 0.08:
                        shift_util *= rng.uniform(0.35, 0.6)
                    elif rng.random() < 0.1:
                        shift_util = min(0.98, shift_util * rng.uniform(1.05, 1.15))

                    for hour in SHIFT_HOURS[shift_name]:
                        # Cross-midnight night hours stay on this history day stamp for bucketing
                        stamp = cursor.replace(hour=hour, minute=rng.randint(5, 50), second=0, microsecond=0)
                        target = hourly_target
                        units = max(0, int(round(target * shift_util * rng.uniform(0.82, 1.12))))
                        # Startup / wind-down softer hours
                        if hour in {6, 13, 14, 21, 22, 5}:
                            units = int(units * rng.uniform(0.55, 0.85))
                        scrap_rate = scrap_bias * rng.uniform(0.5, 1.8)
                        if rng.random() < 0.05:
                            scrap_rate *= rng.uniform(2.0, 4.0)
                        rejected = min(units, max(0, int(round(units * scrap_rate))))
                        good = max(units - rejected, 0)
                        db.add(
                            ProductionRecord(
                                work_order_id=wo.id if wo else None,
                                machine_id=machine.id,
                                shift_id=shift.id,
                                recorded_at=stamp,
                                total_units=units,
                                good_units=good,
                                rejected_units=rejected,
                                source=HISTORY_SOURCE,
                            )
                        )
                        prod_n += 1

                    # Downtime: 1–4 stops per machine-shift (fewer on quiet nights)
                    stop_count = rng.randint(0, 2) if shift_name == "Night" else rng.randint(1, 4)
                    if weekend:
                        stop_count = max(0, stop_count - 1)
                    hours = SHIFT_HOURS[shift_name]
                    for _ in range(stop_count):
                        cat_name, reason, (lo, hi) = rng.choice(_HISTORY_STOPS)
                        # Bias toward MOST_USED-ish reasons
                        if rng.random() < 0.35:
                            cat_name, reason, (lo, hi) = rng.choice(
                                [s for s in _HISTORY_STOPS if s[1] in {
                                    "Unplanned cleaning",
                                    "Product changeover",
                                    "Shift handover",
                                    "Operator missing",
                                    "Unplanned maintenance",
                                    "Material shortage",
                                    "Machine reset",
                                    "Uncommented",
                                }]
                            )
                        mins = rng.randint(lo, hi)
                        hour = rng.choice(hours)
                        started = cursor.replace(
                            hour=hour,
                            minute=rng.randint(0, 40),
                            second=0,
                            microsecond=0,
                        )
                        ended = started + timedelta(minutes=mins)
                        cat = categories.get(cat_name) or categories.get("Uncommented")
                        db.add(
                            DowntimeEvent(
                                machine_id=machine.id,
                                work_order_id=wo.id if wo else None,
                                category_id=cat.id if cat else None,
                                started_at=started,
                                ended_at=ended,
                                reason=reason,
                                reported_by=operator.id if operator else None,
                                verified_by=supervisor.id if supervisor else None,
                                status="Closed",
                                notes="Historical demo downtime",
                            )
                        )
                        dt_n += 1

                # One quality sample most weekdays
                if not weekend and rng.random() < 0.7 and day_shift:
                    inspected = cursor.replace(hour=rng.randint(9, 16), minute=rng.randint(0, 59))
                    good_q = rng.randint(18, 48)
                    rej_q = rng.randint(0, 4)
                    db.add(
                        QualityRecord(
                            machine_id=machine.id,
                            work_order_id=wo.id if wo else None,
                            shift_id=day_shift.id,
                            inspected_at=inspected,
                            good_units=good_q,
                            rejected_units=rej_q,
                            defect_category=rng.choice(
                                ["Dimensional", "Surface", "Missing feature", "Flash", None, None]
                            ),
                            notes="Historical demo inspection",
                        )
                    )
                    qa_n += 1

            cursor += timedelta(days=1)
            if prod_n and prod_n % 2000 == 0:
                db.flush()

        db.commit()
        print(
            f"Historical demo data: {days}d window -> {prod_n} production rows, "
            f"{dt_n} downtime events, {qa_n} quality checks "
            f"({start_day.date()} .. {end_day.date()}, today left for live sim)."
        )
        return {"production": prod_n, "downtime": dt_n, "quality": qa_n}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed_today_progress(*, replace: bool = True) -> dict[str, int]:
    """Seed production for today's elapsed plant hours so Daily Production Count is not all zeros.

    Uses factory timezone. Only fills hours that have already started; leaves later hours empty.
    """
    from app.services.plant_catalog import MACHINES as CATALOG_MACHINES, PRODUCTS as CATALOG_PRODUCTS
    from app.services.station import _factory_tz

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        machines = list(db.scalars(select(Machine).where(Machine.active.is_(True)).order_by(Machine.id.asc())).all())
        shifts = {s.shift_name: s for s in db.scalars(select(Shift)).all()}
        products = list(db.scalars(select(Product).order_by(Product.id.asc())).all())
        by_code = {p.product_code: p for p in products}
        if not machines or not shifts or not products:
            print("Cannot seed today — plant master data missing.")
            return {"production": 0}

        tz = _factory_tz()
        now_local = datetime.now(tz)
        # Dashboard day bounds are UTC calendar dates matching YYYY-MM-DD query
        day_key = now_local.strftime("%Y-%m-%d")
        day_utc_start = datetime.strptime(day_key, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        day_utc_end = day_utc_start + timedelta(days=1)

        if replace:
            db.execute(
                delete(ProductionRecord).where(
                    ProductionRecord.source == HISTORY_SOURCE,
                    ProductionRecord.recorded_at >= day_utc_start,
                    ProductionRecord.recorded_at < day_utc_end,
                )
            )
            db.commit()

        catalog_by_code = {m["code"]: m for m in CATALOG_MACHINES}
        product_meta = {p["code"]: p for p in CATALOG_PRODUCTS}
        open_wos = {
            wo.machine_id: wo
            for wo in db.scalars(select(WorkOrder).where(WorkOrder.status.in_(["In Progress", "Paused", "Completed"]))).all()
        }
        day_shift = shifts.get("Day")
        afternoon = shifts.get("Afternoon")
        night = shifts.get("Night")
        shift_objs = [("Day", day_shift), ("Afternoon", afternoon), ("Night", night)]

        current_hour = now_local.hour
        elapsed_hours = {h for hours in SHIFT_HOURS.values() for h in hours if h <= current_hour}

        prod_n = 0
        for m_idx, machine in enumerate(machines):
            rng = random.Random(f"{HISTORY_SOURCE}:today:{machine.id}:{day_key}")
            spec = catalog_by_code.get(machine.machine_code) or {}
            product_code = spec.get("product_code") or products[m_idx % len(products)].product_code
            product = by_code.get(product_code) or products[m_idx % len(products)]
            meta = product_meta.get(product.product_code) or {}
            hourly_target = int(meta.get("hourly_target") or max(int(3600 / (product.ideal_cycle_time or 60)), 12))
            wo = open_wos.get(machine.id)
            util_bias = 0.72 + (m_idx % 5) * 0.04

            for shift_name, shift in shift_objs:
                if not shift:
                    continue
                shift_util = util_bias * (0.92 if shift_name == "Day" else 0.85 if shift_name == "Afternoon" else 0.7)
                for hour in SHIFT_HOURS[shift_name]:
                    if hour not in elapsed_hours:
                        continue
                    # Stamp as UTC midnight + hour so dashboard UTC day bucket matches date query
                    stamp = day_utc_start.replace(hour=hour, minute=rng.randint(5, 50), second=0, microsecond=0)
                    if stamp > datetime.now(timezone.utc) + timedelta(minutes=5):
                        continue
                    units = max(0, int(round(hourly_target * shift_util * rng.uniform(0.82, 1.12))))
                    if hour in {6, 13, 14, 21, 22, 5}:
                        units = int(units * rng.uniform(0.55, 0.85))
                    scrap_rate = (0.012 + (m_idx % 4) * 0.006) * rng.uniform(0.5, 1.8)
                    rejected = min(units, max(0, int(round(units * scrap_rate))))
                    good = max(units - rejected, 0)
                    db.add(
                        ProductionRecord(
                            work_order_id=wo.id if wo else None,
                            machine_id=machine.id,
                            shift_id=shift.id,
                            recorded_at=stamp,
                            total_units=units,
                            good_units=good,
                            rejected_units=rejected,
                            source=HISTORY_SOURCE,
                        )
                    )
                    prod_n += 1

        db.commit()
        print(f"Today progress seed: {prod_n} production rows for {day_key} (hours <= {current_hour}).")
        return {"production": prod_n}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.scalar(select(User).limit(1)):
            print("Database already seeded. Skipping master data.")
            seed_staff_assignments_demo(db)
            db.close()
            seed_historical_data(days=30)
            seed_today_progress()
            return

        roles = [
            Role(role_name="Administrator", permissions="*"),
            Role(role_name="Production Manager", permissions="dashboard,reports,orders"),
            Role(role_name="Production Supervisor", permissions="dashboard,orders,downtime,quality"),
            Role(role_name="Machine Operator", permissions="machine,production,downtime,quality"),
            Role(role_name="Maintenance User", permissions="machines,downtime,alerts"),
        ]
        db.add_all(roles)
        db.flush()

        admin = User(
            name="Alex Admin",
            email="admin@octavia.local",
            password_hash=get_password_hash("admin123"),
            role_id=roles[0].id,
        )
        manager = User(
            name="Morgan Manager",
            email="manager@octavia.local",
            password_hash=get_password_hash("manager123"),
            role_id=roles[1].id,
        )
        supervisor = User(
            name="Sam Supervisor",
            email="supervisor@octavia.local",
            password_hash=get_password_hash("super123"),
            role_id=roles[2].id,
        )
        operator = User(
            name="Ollie Operator",
            email="operator@octavia.local",
            password_hash=get_password_hash("operator123"),
            role_id=roles[3].id,
        )
        maintenance = User(
            name="Max Maintenance",
            email="maintenance@octavia.local",
            password_hash=get_password_hash("maint123"),
            role_id=roles[4].id,
        )
        junior = User(
            name="Jamie Junior",
            email="junior1@octavia.local",
            password_hash=get_password_hash("junior123"),
            role_id=roles[3].id,
        )
        operator2 = User(
            name="Pat Press",
            email="op2@octavia.local",
            password_hash=get_password_hash("operator123"),
            role_id=roles[3].id,
        )
        lead2 = User(
            name="Taylor Teamlead",
            email="lead2@octavia.local",
            password_hash=get_password_hash("lead123"),
            role_id=roles[2].id,
        )
        db.add_all([admin, manager, supervisor, operator, maintenance, junior, operator2, lead2])
        db.flush()

        site = Site(
            site_name="Tanui Plastic Plant",
            location="Injection molding · Outdoor accessories",
            timezone="Africa/Nairobi",
        )
        db.add(site)
        db.flush()

        molding = Department(site_id=site.id, department_name="Injection Molding")
        finishing = Department(site_id=site.id, department_name="Finishing")
        db.add_all([molding, finishing])
        db.flush()

        line_a = ProductionLine(department_id=molding.id, line_name="Molding Hall A")
        line_b = ProductionLine(department_id=molding.id, line_name="Molding Hall B")
        line_c = ProductionLine(department_id=finishing.id, line_name="Finishing")
        db.add_all([line_a, line_b, line_c])
        db.flush()

        shifts = [
            Shift(site_id=site.id, shift_name="Day", start_time=time(6, 0), end_time=time(14, 0)),
            Shift(site_id=site.id, shift_name="Afternoon", start_time=time(14, 0), end_time=time(22, 0)),
            Shift(site_id=site.id, shift_name="Night", start_time=time(22, 0), end_time=time(6, 0)),
        ]
        db.add_all(shifts)
        db.flush()

        products = [
            Product(
                product_code="STO-240",
                product_name="Garden Storage Box 240L",
                ideal_cycle_time=75,
                unit_of_measure="pcs",
            ),
            Product(
                product_code="CHR-01",
                product_name="Outdoor Garden Chair",
                ideal_cycle_time=100,
                unit_of_measure="pcs",
            ),
            Product(
                product_code="PLN-35",
                product_name="Ribbed Planter 35cm",
                ideal_cycle_time=40,
                unit_of_measure="pcs",
            ),
            Product(
                product_code="CAB-XL",
                product_name="Outdoor Utility Cabinet",
                ideal_cycle_time=150,
                unit_of_measure="pcs",
            ),
            Product(
                product_code="SHF-5T",
                product_name="Modular Shelf 5-Tier",
                ideal_cycle_time=120,
                unit_of_measure="pcs",
            ),
        ]
        db.add_all(products)
        db.flush()

        categories = [
            DowntimeCategory(category_name="Technical", planned_or_unplanned="unplanned"),
            DowntimeCategory(category_name="Setup", planned_or_unplanned="planned"),
            DowntimeCategory(category_name="Maintenance", planned_or_unplanned="planned"),
            DowntimeCategory(category_name="Organisational", planned_or_unplanned="unplanned"),
            DowntimeCategory(category_name="Material", planned_or_unplanned="unplanned"),
            DowntimeCategory(category_name="Quality", planned_or_unplanned="unplanned"),
            DowntimeCategory(category_name="Break", planned_or_unplanned="planned"),
            DowntimeCategory(category_name="Uncommented", planned_or_unplanned="unplanned"),
        ]
        db.add_all(categories)
        db.flush()

        now = datetime.now(timezone.utc)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        machines_spec = [
            ("IMM-01", "Engel Duo 700", line_a.id, "Injection Press", "Running"),
            ("IMM-02", "Engel Victory 500", line_a.id, "Injection Press", "Running"),
            ("IMM-03", "KraussMaffei CX 350", line_a.id, "Injection Press", "Idle"),
            ("IMM-04", "Engel Duo 1100", line_b.id, "Injection Press", "Setup"),
            ("IMM-05", "Husky HyPET 300", line_b.id, "Injection Press", "Running"),
            ("IMM-06", "Engel Victory 280", line_b.id, "Injection Press", "Fault"),
            ("ASM-01", "Assembly Cell North", line_c.id, "Assembly", "Running"),
            ("ASM-02", "Assembly Cell South", line_c.id, "Assembly", "Planned Stop"),
        ]
        machines: list[Machine] = []
        for code, name, line_id, mtype, status in machines_spec:
            m = Machine(
                production_line_id=line_id,
                machine_code=code,
                machine_name=name,
                machine_type=mtype,
                status=status,
                active=True,
                last_update_at=now - timedelta(minutes=random.randint(1, 20)),
                status_source="demo",
            )
            machines.append(m)
        db.add_all(machines)
        db.flush()

        # Work orders
        work_orders = []
        for i, m in enumerate(machines[:6]):
            product = products[i % len(products)]
            # Day shift 06–14 (8h); targets vary by accessory (planters faster than cabinets)
            cycle = product.ideal_cycle_time or 60
            hourly = max(int(3600 / cycle), 12)
            planned = hourly * 8
            actual = int(planned * random.uniform(0.55, 0.92))
            rejected = int(actual * random.uniform(0.01, 0.05))
            good = actual - rejected
            wo = WorkOrder(
                order_number=f"WO-TNU-{1000 + i}",
                product_id=product.id,
                machine_id=m.id,
                planned_quantity=planned,
                actual_quantity=actual,
                good_quantity=good,
                rejected_quantity=rejected,
                planned_start=today + timedelta(hours=6),
                planned_end=today + timedelta(hours=14),
                actual_start=today + timedelta(hours=6, minutes=10),
                customer_ref=f"EU-{200 + i}",
                status="In Progress" if m.status != "Fault" else "Paused",
            )
            work_orders.append(wo)
        db.add_all(work_orders)
        db.flush()

        # Hourly production for today (day shift)
        day_shift = shifts[0]
        for m, wo in zip(machines, work_orders + [None] * 2):
            if not wo:
                continue
            prod = next((p for p in products if p.id == wo.product_id), products[0])
            for hour in range(6, min(now.hour + 1 if now.hour >= 6 else 14, 14)):
                cycle = prod.ideal_cycle_time or 60
                target = max(int(3600 / cycle), 12)
                units = random.randint(int(target * 0.55), target)
                rejected = random.randint(0, max(1, units // 40))
                good = max(units - rejected, 0)
                db.add(
                    ProductionRecord(
                        work_order_id=wo.id,
                        machine_id=m.id,
                        shift_id=day_shift.id,
                        recorded_at=today + timedelta(hours=hour, minutes=random.randint(0, 50)),
                        total_units=units,
                        good_units=good,
                        rejected_units=rejected,
                        source="demo",
                    )
                )

        # Machine events + downtime
        for m in machines:
            db.add(
                MachineEvent(
                    machine_id=m.id,
                    event_type=m.status,
                    started_at=now - timedelta(hours=random.randint(1, 4)),
                    source="demo",
                    notes=f"Demo state: {m.status}",
                )
            )

        dt_samples = [
            (machines[2], categories[0], "Hydraulic issue", 45),
            (machines[3], categories[1], "Product changeover", 25),
            (machines[5], categories[0], "Heater fault", 70),
            (machines[7], categories[2], "Scheduled PM", 40),
            (machines[1], categories[4], "Material shortage", 18),
            (machines[0], categories[7], "Uncommented", 12),
            (machines[4], categories[3], "Operator missing", 22),
            (machines[6], categories[5], "Quality hold", 15),
        ]
        for m, cat, reason, mins in dt_samples:
            started = now - timedelta(hours=random.randint(1, 5))
            db.add(
                DowntimeEvent(
                    machine_id=m.id,
                    category_id=cat.id,
                    started_at=started,
                    ended_at=started + timedelta(minutes=mins),
                    reason=reason,
                    reported_by=operator.id,
                    verified_by=supervisor.id,
                    status="Closed" if mins < 60 else "Open",
                    notes="Seeded demo downtime",
                )
            )

        # Quality
        for m, wo in zip(machines[:5], work_orders[:5]):
            db.add(
                QualityRecord(
                    machine_id=m.id,
                    work_order_id=wo.id,
                    shift_id=day_shift.id,
                    inspected_at=now - timedelta(hours=random.randint(0, 4)),
                    good_units=random.randint(20, 40),
                    rejected_units=random.randint(0, 3),
                    defect_category=random.choice(["Dimensional", "Surface", "Missing feature", None]),
                    notes="Demo inspection",
                )
            )

        # Alerts / actions
        alerts = [
            Alert(
                machine_id=machines[5].id,
                alert_type="fault",
                severity="critical",
                message="CNC-06 drive fault — production stopped",
                assigned_to=maintenance.id,
                status="Open",
            ),
            Alert(
                machine_id=machines[2].id,
                alert_type="idle",
                severity="medium",
                message="CNC-03 idle beyond 20 minute threshold",
                assigned_to=supervisor.id,
                status="Acknowledged",
            ),
            Alert(
                machine_id=machines[1].id,
                alert_type="behind_target",
                severity="high",
                message="CNC-02 behind hourly target for last 2 hours",
                assigned_to=manager.id,
                status="Open",
            ),
            Alert(
                machine_id=machines[0].id,
                alert_type="rejection_rate",
                severity="medium",
                message="Rejection rate above 5% on BRG-100",
                assigned_to=supervisor.id,
                status="Open",
            ),
        ]
        db.add_all(alerts)
        db.flush()
        db.add(
            ActionItem(
                alert_id=alerts[0].id,
                title="Inspect IMM-06 hydraulic pack and reset fault",
                owner_id=maintenance.id,
                due_date=now + timedelta(hours=4),
                status="Open",
            )
        )

        db.add(
            ShiftNote(
                site_id=site.id,
                shift_id=day_shift.id,
                note_date=today + timedelta(hours=12),
                author_id=supervisor.id,
                content="Day shift handover: IMM-06 fault escalated to maintenance. Hall A otherwise on plan. Resin delay cleared at 10:40.",
            )
        )
        db.add(
            ShiftNote(
                site_id=site.id,
                shift_id=day_shift.id,
                note_date=today + timedelta(hours=11),
                author_id=operator.id,
                content="Mould life warning on IMM-04 — colour changeover booked for 13:00 (cabinet beige).",
            )
        )

        db.commit()
        seed_staff_assignments_demo(db)
        print("Tanui Plastic Plant demo data seeded successfully.")
        print("Login: admin@octavia.local / admin123")
        db.close()
        seed_historical_data(days=30)
        seed_today_progress()
        return
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def retheme_plant() -> None:
    """Update an already-seeded DB to Tanui Plastic Plant identity."""
    from app.services.plant_catalog import MACHINES, PRODUCTS, PLANT

    db = SessionLocal()
    try:
        site = db.scalar(select(Site).limit(1))
        if site:
            site.site_name = PLANT["site_name"]
            site.location = PLANT["location"]
            site.timezone = PLANT["timezone"]

        products = list(db.scalars(select(Product).order_by(Product.id.asc())).all())
        for i, p in enumerate(PRODUCTS):
            if i < len(products):
                products[i].product_code = p["code"]
                products[i].product_name = p["name"]
                products[i].ideal_cycle_time = p["cycle_seconds"]
                products[i].unit_of_measure = p["unit"]
            else:
                db.add(
                    Product(
                        product_code=p["code"],
                        product_name=p["name"],
                        ideal_cycle_time=p["cycle_seconds"],
                        unit_of_measure=p["unit"],
                    )
                )
        db.flush()

        machines = list(db.scalars(select(Machine).order_by(Machine.id.asc())).all())
        for i, spec in enumerate(MACHINES):
            if i >= len(machines):
                break
            machines[i].machine_code = spec["code"]
            machines[i].machine_name = spec["name"]
            machines[i].machine_type = spec["type"]

        # Align open work orders to catalog products
        products = list(db.scalars(select(Product).order_by(Product.id.asc())).all())
        by_code = {p.product_code: p for p in products}
        wos = list(db.scalars(select(WorkOrder).order_by(WorkOrder.id.asc())).all())
        for i, wo in enumerate(wos):
            spec = MACHINES[i % len(MACHINES)]
            prod = by_code.get(spec["product_code"]) or products[i % len(products)]
            wo.product_id = prod.id
            hourly = int(3600 / (prod.ideal_cycle_time or 60))
            wo.planned_quantity = hourly * 8

        db.commit()
        print("Rethemed database to Tanui Plastic Plant.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Back-compat alias
retheme_ebes = retheme_plant


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] in {"--retheme", "retheme"}:
        retheme_plant()
    elif len(sys.argv) > 1 and sys.argv[1] in {"--history", "history"}:
        hist_days = int(sys.argv[2]) if len(sys.argv) > 2 else 30
        seed_historical_data(days=hist_days)
        seed_today_progress()
    elif len(sys.argv) > 1 and sys.argv[1] in {"--today", "today"}:
        seed_today_progress()
    else:
        seed()
