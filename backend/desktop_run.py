"""Desktop entry: FastAPI + optional static UI for the Windows app."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _prepare_paths() -> Path:
    if getattr(sys, "frozen", False):
        # PyInstaller one-folder / one-file
        base = Path(sys.executable).resolve().parent
        meipass = Path(getattr(sys, "_MEIPASS", base))
        # Ensure bundled app package is importable
        if str(meipass) not in sys.path:
            sys.path.insert(0, str(meipass))
        return base
    base = Path(__file__).resolve().parent
    if str(base) not in sys.path:
        sys.path.insert(0, str(base))
    return base


def main() -> None:
    base = _prepare_paths()
    parser = argparse.ArgumentParser(description="Octavia desktop API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17800)
    parser.add_argument(
        "--static-dir",
        default=os.environ.get("OCTAVIA_STATIC_DIR", ""),
        help="Built frontend dist folder to serve",
    )
    parser.add_argument(
        "--env-file",
        default=os.environ.get("OCTAVIA_ENV_FILE", str(base / ".env")),
        help="Path to .env for database settings",
    )
    args = parser.parse_args()

    env_path = Path(args.env_file)
    if env_path.is_file():
        os.environ.setdefault("OCTAVIA_ENV_FILE", str(env_path))
        # pydantic-settings reads .env from cwd by default; also load explicitly
        try:
            from dotenv import load_dotenv

            load_dotenv(env_path, override=False)
        except Exception:
            pass

    if args.static_dir:
        os.environ["OCTAVIA_STATIC_DIR"] = str(Path(args.static_dir).resolve())

    # Import after env is ready
    import uvicorn

    from app.main import app  # noqa: F401 — registers routes + static

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
