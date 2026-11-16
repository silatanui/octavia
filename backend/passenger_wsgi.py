"""cPanel / CloudLinux Passenger entrypoint for Octavia (FastAPI ASGI → WSGI).

Uses an explicit asyncio event loop. Passenger worker threads often have no
loop (or a closed one), which makes a2wsgi hang until the HTTP timeout.
"""

from __future__ import annotations

import asyncio
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


def _event_loop() -> asyncio.AbstractEventLoop:
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError("closed")
    except Exception:  # noqa: BLE001
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop


application = ASGIMiddleware(_IgnoreLifespan(asgi_app), loop=_event_loop())
