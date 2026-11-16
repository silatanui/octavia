"""cPanel / CloudLinux Passenger entrypoint for Octavia (FastAPI ASGI → WSGI).

Follows the same lazy-load pattern as LyricSync on this host:
load the app on first request, and surface startup errors in the HTTP body
instead of hanging/500ing opaquely.

Do NOT pass a module-level asyncio loop into a2wsgi — Passenger serves
requests on worker threads and a foreign loop deadlocks until timeout.
"""

from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("LC_ALL", "C.UTF-8")

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("OCTAVIA_ENV_FILE", str(ROOT / ".env"))

_cached_app = None
_load_error: tuple[str, str] | None = None


class _IgnoreLifespan:
    """Complete lifespan immediately so WSGI hosts do not block forever."""

    def __init__(self, app: Callable[..., Any]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope.get("type") == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                elif message["type"] == "lifespan.shutdown":
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        await self.app(scope, receive, send)


def _build_app():
    from a2wsgi import ASGIMiddleware
    from app.core.database import Base, engine
    from app.main import app as asgi_app
    import app.models  # noqa: F401

    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:  # noqa: BLE001
        print(f"[octavia] passenger schema ensure skipped: {exc}", file=sys.stderr)

    # No loop= here — let a2wsgi manage the loop on the request thread.
    return ASGIMiddleware(_IgnoreLifespan(asgi_app))


def application(environ, start_response):
    global _cached_app, _load_error

    if _cached_app is None and _load_error is None:
        try:
            _cached_app = _build_app()
        except Exception as exc:  # noqa: BLE001
            _load_error = (str(exc), traceback.format_exc())

    if _load_error:
        err_msg, tb = _load_error
        body = (
            "<!DOCTYPE html><html><head><title>Octavia Startup Error</title></head>"
            "<body style=\"font-family:monospace;padding:2rem;background:#fff5f5;color:#900;\">"
            "<h2>Octavia Application Startup Error</h2>"
            f"<p><b>{err_msg}</b></p><pre>{tb}</pre></body></html>"
        ).encode("utf-8")
        # 200 so cPanel/LiteSpeed error pages do not hide the traceback
        start_response(
            "200 OK",
            [("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(body)))],
        )
        return [body]

    return _cached_app(environ, start_response)
