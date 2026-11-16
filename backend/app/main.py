import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, alerts, analysis, auth, dashboard, downtime, machines, production, quality, reports, staffing, work_orders
from app.core.config import get_settings
from app.core.database import Base, engine
import app.models  # noqa: F401 — register metadata for create_all

settings = get_settings()

app = FastAPI(title=settings.app_name, version="1.0.0")


@app.on_event("startup")
def _ensure_schema() -> None:
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:  # noqa: BLE001 — keep API up if MySQL is briefly down
        print(f"[octavia] schema ensure skipped: {exc}")

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
# Local Vite + production Tanui hostnames (subdomains of tanuisila.dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_origin_regex=(
        r"https?://(localhost|127\.0\.0\.1)(:\d+)?|"
        r"https?://([a-z0-9-]+\.)*tanuisila\.dev"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = settings.api_prefix
app.include_router(auth.router, prefix=api)
app.include_router(dashboard.router, prefix=api)
app.include_router(machines.router, prefix=api)
app.include_router(work_orders.router, prefix=api)
app.include_router(production.router, prefix=api)
app.include_router(downtime.router, prefix=api)
app.include_router(quality.router, prefix=api)
app.include_router(alerts.router, prefix=api)
app.include_router(admin.router, prefix=api)
app.include_router(staffing.router, prefix=api)
app.include_router(analysis.router, prefix=api)
app.include_router(reports.router, prefix=api)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name, "demo_mode": settings.demo_mode}


def _resolve_static_dir() -> Path | None:
    """Desktop OCTAVIA_STATIC_DIR, else frontend/dist for same-host production (cPanel)."""
    env_dir = os.environ.get("OCTAVIA_STATIC_DIR", "").strip()
    candidates: list[Path] = []
    if env_dir:
        candidates.append(Path(env_dir))
    here = Path(__file__).resolve()
    # backend/app/main.py -> ../../frontend/dist
    candidates.append(here.parents[2] / "frontend" / "dist")
    # backend/main sibling layout on some hosts
    candidates.append(here.parents[1] / "frontend" / "dist")
    for root in candidates:
        if root.is_dir() and (root / "index.html").is_file():
            return root
    return None


def _mount_ui() -> None:
    """Serve the Vite build (desktop bundle or cPanel production dist)."""
    root = _resolve_static_dir()
    if root is None:
        return

    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    @app.get("/")
    def spa_index():
        return FileResponse(root / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Keep API / health on the backend routers above
        candidate = root / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(root / "index.html")


_mount_ui()
