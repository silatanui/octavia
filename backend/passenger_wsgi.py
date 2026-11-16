"""cPanel / CloudLinux Passenger entrypoint for Octavia (FastAPI ASGI → WSGI).

Point the Python App application root at the `backend` folder and set
the startup file to `passenger_wsgi.py`.

a2wsgi 1.10.x has no lifespan= kwarg; we swallow ASGI lifespan ourselves so
Passenger/LiteSpeed does not hang on startup/shutdown hooks.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("OCTAVIA_ENV_FILE", str(ROOT / ".env"))

from a2wsgi import ASGIMiddleware  # noqa: E402
from app.core.database import Base, engine  # noqa: E402
from app.main import app as asgi_app  # noqa: E402
import app.models  # noqa: F401, E402

try:
    Base.metadata.create_all(bind=engine)
except Exception as exc:  # noqa: BLE001
    print(f"[octavia] passenger schema ensure skipped: {exc}", file=sys.stderr)


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


application = ASGIMiddleware(_IgnoreLifespan(asgi_app))
