"""cPanel / CloudLinux Passenger entrypoint for Octavia (FastAPI ASGI → WSGI).

Point the Python App application root at the `backend` folder and set
the startup file to `passenger_wsgi.py`.

lifespan is disabled: under Passenger/LiteSpeed, ASGI lifespan via a2wsgi
often hangs forever (browser spins). Schema bootstrap runs eagerly instead.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Prefer the project .env next to this file (cPanel Python App may cwd elsewhere)
os.environ.setdefault("OCTAVIA_ENV_FILE", str(ROOT / ".env"))

from a2wsgi import ASGIMiddleware  # noqa: E402
from app.core.database import Base, engine  # noqa: E402
from app.main import app as asgi_app  # noqa: E402
import app.models  # noqa: F401, E402

try:
    Base.metadata.create_all(bind=engine)
except Exception as exc:  # noqa: BLE001
    print(f"[octavia] passenger schema ensure skipped: {exc}", file=sys.stderr)

# lifespan="off" avoids Passenger hang on ASGI startup/shutdown hooks
application = ASGIMiddleware(asgi_app, lifespan="off")
